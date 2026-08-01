/* =============================================================
   map.js — 地圖檢視整合模組
   內容：LocationIQ 地理編碼、Leaflet 圖釘、地圖圖例、
         地圖類型篩選、地圖資訊視窗
   （原始檔案此區塊已有完整說明註解，保留原樣於下方）
============================================================= */

/* =============================================================
    地圖檢視（Leaflet 地圖 + LocationIQ 地址查詢）
    地圖底圖：OpenStreetMap（免費、不需金鑰）
    地址轉座標：LocationIQ（免費方案：每天 5,000 次查詢、每秒 2 次）
    ⚠️ API 金鑰不放在前端，改由後端 (.gs 的 geocode action) 代打 LocationIQ，
       金鑰只存在 Google Apps Script 的「指令碼屬性」裡，瀏覽器端看不到。
============================================================= */

let isMapView = false;
let map = null;
let mapMarkers = [];
let mapRenderToken = 0; // 防止舊查詢結果蓋掉新篩選
let selectedMapTypes = new Set(); // 空集合代表「全部類型」都顯示；點擊圖例可篩選只顯示特定類型的圖釘
let lastMapLegendItems = []; // 記住目前這批地圖資料，篩選類型時可以重新畫圖例而不用重新定位
const geocodeCache = new Map(); // 地址 -> {lat, lng, precision}
const geocodeInFlight = new Map(); // 地址 -> 進行中的查詢 Promise（背景預先定位和地圖畫面共用，避免同一地址被重複查詢）

// 依「類型」自動配色的圖釘
// 從固定色盤中挑色（而不是隨機色相），確保顏色彼此夠好分辨，且同一類型每次重新整理都拿到同一個顏色
const PIN_COLOR_PALETTE = [
    "#e2492a", "#2a7de1", "#2aa876", "#a855c9", "#e0a72a",
    "#2a9fd6", "#c9457a", "#6a5acd", "#3aa35c", "#d67d1f",
    "#5c6bc0", "#8d6e63"
];
const PIN_COLOR_UNCATEGORIZED = "#8a8f98"; // 沒填類型的店家，統一用灰色圖釘

function hashStringToIndex(str, mod){
    let hash = 0;
    for(let i = 0; i < str.length; i++){
        hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash % mod;
}

function getPinColor(type){
    if(!type) return PIN_COLOR_UNCATEGORIZED;
    return PIN_COLOR_PALETTE[hashStringToIndex(String(type), PIN_COLOR_PALETTE.length)];
}

const pinIconCache = new Map(); // type -> L.divIcon（同類型共用同一個圖示，不用每個 marker 都重建 SVG）

function getFoodPinIcon(type){
    const key = type ? String(type) : "__uncategorized__";
    if(pinIconCache.has(key)) return pinIconCache.get(key);

    const color = getPinColor(type);
    const icon = L.divIcon({
        className: "food-map-pin",
        html: '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 34 44">' +
              '<path d="M17 0C7.6 0 0 7.6 0 17c0 12.7 17 27 17 27s17-14.3 17-27C34 7.6 26.4 0 17 0z" fill="' + color + '"/>' +
              '<circle cx="17" cy="17" r="7.5" fill="#fffbf4"/>' +
              '</svg>',
        iconSize: [30, 40],
        iconAnchor: [15, 40],
        popupAnchor: [0, -38]
    });
    pinIconCache.set(key, icon);
    return icon;
}

// 點擊「🗺️ 地圖檢視」
function openMapView(){
    document.getElementById("mapView").classList.add("show");
    isMapView = true;
    document.getElementById("mapLoading").style.display = "flex";

    if(!map){
        map = L.map("mapCanvas").setView([23.9738, 120.9820], 7); // 台灣中心
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors | <a href="https://locationiq.com" target="_blank">Search by LocationIQ.com</a>',
            maxZoom: 19
        }).addTo(map);
    }

    renderMapMarkers(getCurrentFilteredData());

    setTimeout(function(){
        map.invalidateSize();
    }, 60);
}

function closeMapView(){
    document.getElementById("mapView").classList.remove("show");
    isMapView = false;
    selectedMapTypes.clear(); // 下次重新打開地圖時，預設恢復「顯示全部類型」
}

function getCurrentFilteredData(){
    const keyword = document.getElementById("searchInp").value.toLowerCase();
    return allFoodData.filter(item=>{
        // 同 filterFood()：先轉成字串再比對，避免數字型態的店名/類型/地址讓程式出錯
        const matchesKeyword = (
            (item.name && String(item.name).toLowerCase().includes(keyword)) ||
            (item.type && String(item.type).toLowerCase().includes(keyword)) ||
            (item.address && String(item.address).toLowerCase().includes(keyword))
        );
        const matchesFavorite = !showFavoritesOnly || favoriteNames.has(String(item.name));
        const itemRegion = detectRegion(item.address);
        const matchesRegion = selectedRegions.size === 0 || (itemRegion && selectedRegions.has(itemRegion));
        const itemType = item.type ? String(item.type) : null;
        const matchesType = selectedTypes.size === 0 || (itemType && selectedTypes.has(itemType));
        return matchesKeyword && matchesFavorite && matchesRegion && matchesType;
    });
}

/* =============================================================
    背景預先定位
    在使用者點擊「地圖檢視」之前，就利用瀏覽器閒置時間把地址逐一轉成座標，
    存進 geocodeCache。等使用者真的打開地圖時，大部分（甚至全部）圖釘
    都已經算好座標，可以直接顯示，不用再等待逐筆查詢。
============================================================= */
let backgroundPrefetchToken = 0;

function prefetchGeocodesInBackground(){
    // 每次資料重新載入（新增/編輯/刪除後）都會呼叫這裡，用 token 讓舊的背景工作自動失效，避免重複或衝突
    const token = ++backgroundPrefetchToken;
    const itemsToPrefetch = allFoodData.filter(item => item.address && !geocodeCache.has(item.address));

    if(itemsToPrefetch.length === 0) return;

    let i = 0;
    function processNext(){
        if(token !== backgroundPrefetchToken) return; // 資料已經變了，這一輪背景工作停止

        if(i >= itemsToPrefetch.length) return;

        // 使用者已經打開地圖畫面：地圖自己的載入流程（含進度提示）會處理查詢，
        // 背景工作先禮讓、稍後再檢查一次，避免搶同一批請求配額
        if(isMapView){
            setTimeout(processNext, 1000);
            return;
        }

        const item = itemsToPrefetch[i];
        geocodeAddress(item.address)
            .catch(function(err){
                console.warn("背景預先定位失敗：", item.name, item.address, err.message);
            })
            .finally(function(){
                if(token !== backgroundPrefetchToken) return;
                i++;
                setTimeout(processNext, 1200); // 沿用與地圖畫面相同的節流間隔，避免超過 LocationIQ 速率限制
            });
    }

    processNext();
}

// 產生多層級的備用地址
function getAddressFallbacks(address) {
    const list = [];
    if (!address) return list;

    let current = address.trim();
    list.push({ text: current, precision: "exact" });

    // 1. 移除社區、新村、里、鄰等雜訊
    let simplified = current.replace(/[^路街段巷弄區市縣\s\d]{1,8}(新村|社區|社区|花園|花园|山莊|山庄|別墅|别墅|大樓|大楼|大廈|大厦|國宅|国宅|莊園|庄园|里|村)(\d+鄰)?/g, "");
    simplified = simplified.replace(/(\D)號/g, "$1");
    simplified = simplified.replace(/\s+/g, " ").trim();
    if (simplified && simplified !== current) {
        list.push({ text: simplified, precision: "exact" });
        current = simplified;
    }

    // 2. 移除門牌號碼（縮減至路段/巷弄層級）
    let noHouseNumber = current.replace(/\d+(號|之\d+號|F|樓|室).*$/, "").trim();
    if (noHouseNumber && noHouseNumber !== current) {
        list.push({ text: noHouseNumber, precision: "street" });
        current = noHouseNumber;
    }

    // 3. 移除巷弄（縮減至主路段）
    let noLane = current.replace(/\d+(巷|弄).*$/, "").trim();
    if (noLane && noLane !== current) {
        list.push({ text: noLane, precision: "street" });
    }

    // 4. 粗略定位 - 行政區級（例如：台南市中西區）
    const districtMatch = address.match(/^.*?[市縣].*?[區鄉鎮市]/);
    if (districtMatch) {
        list.push({ text: districtMatch[0], precision: "district" });
    }

    // 5. 極度粗略定位 - 縣市級（例如：台南市）
    const cityMatch = address.match(/^.*?[市縣]/);
    if (cityMatch) {
        list.push({ text: cityMatch[0], precision: "city" });
    }

    const uniqueList = [];
    const seenTexts = new Set();
    for (let item of list) {
        if (item.text.length >= 3 && !seenTexts.has(item.text)) {
            seenTexts.add(item.text);
            uniqueList.push(item);
        }
    }
    if (uniqueList.length === 0) {
        uniqueList.push({ text: address, precision: "exact" });
    }
    return uniqueList;
}

// 驗證定位結果，防止「跨縣市嚴重漂移」
function verifyGeocodeResult(originalAddress, result) {
    if (!result || !result.display_name) return false;
    
    const cities = [
        { key: "台北", names: ["台北", "臺北", "taipei"] },
        { key: "新北", names: ["新北", "new taipei"] },
        { key: "桃園", names: ["桃園", "taoyuan"] },
        { key: "台中", names: ["台中", "臺中", "taichung"] },
        { key: "台南", names: ["台南", "臺南", "tainan"] },
        { key: "高雄", names: ["高雄", "kaohsiung"] },
        { key: "基隆", names: ["基隆", "keelung"] },
        { key: "新竹", names: ["新竹", "hsinchu"] },
        { key: "苗栗", names: ["苗栗", "miaoli"] },
        { key: "彰化", names: ["彰化", "changhua"] },
        { key: "南投", names: ["南投", "nantou"] },
        { key: "雲林", names: ["雲林", "yunlin"] },
        { key: "嘉義", names: ["嘉義", "chiayi"] },
        { key: "屏東", names: ["屏東", "pingtung"] },
        { key: "宜蘭", names: ["宜蘭", "yilan"] },
        { key: "花蓮", names: ["花蓮", "hualien"] },
        { key: "台東", names: ["台東", "臺東", "taitung"] },
        { key: "澎湖", names: ["澎湖", "penghu"] },
        { key: "金門", names: ["金門", "kinmen"] },
        { key: "連江", names: ["連江", "matsu"] }
    ];
    
    let expectedCityObj = null;
    const normAddr = originalAddress.toLowerCase();
    for (let city of cities) {
        if (city.names.some(name => normAddr.includes(name))) {
            expectedCityObj = city;
            break;
        }
    }
    
    if (!expectedCityObj) return true;
    
    const displayName = result.display_name.toLowerCase();
    return expectedCityObj.names.some(name => displayName.includes(name));
}

// 送出查詢（改走自己的後端 geocode action，LocationIQ 金鑰留在伺服器端，不會出現在瀏覽器裡）
function geocodeQuery_(query){
    return apiGet("geocode", { q: query })
        .then(function(result){
            return {
                lat: parseFloat(result.lat),
                lng: parseFloat(result.lng),
                display_name: result.display_name || ""
            };
        });
    // 注意：apiGet() 內部若收到 { error: "..." }，會 throw new Error(json.error)，
    // 訊息會是 "NOT_FOUND" / "HTTP_429" / "HTTP_xxx"，跟原本直接打 LocationIQ 時一致，
    // 下面 tryFallback() 的重試/備援邏輯完全不用改
}

// 核心地理編碼控制
function geocodeAddress(address){
    if(geocodeCache.has(address)){
        return Promise.resolve(geocodeCache.get(address));
    }

    // 若同一個地址已經有查詢在進行中（例如背景預先定位正在跑），直接共用同一個 Promise，不重複發送請求
    if(geocodeInFlight.has(address)){
        return geocodeInFlight.get(address);
    }

    const fallbacks = getAddressFallbacks(address);
    
    function tryFallback(index, retryCount) {
        if (index >= fallbacks.length) {
            return Promise.reject(new Error("NOT_FOUND"));
        }
        
        const item = fallbacks[index];
        return geocodeQuery_(item.text)
            .then(function(res){
                if (!verifyGeocodeResult(address, res)) {
                    console.warn(`[防飄移攔截] 查詢 "${item.text}" 定位到了外縣市，已自動阻擋。`);
                    throw new Error("MISMATCHED_CITY");
                }
                
                const result = { 
                    lat: res.lat, 
                    lng: res.lng, 
                    precision: item.precision,
                    matchedText: item.text
                };
                geocodeCache.set(address, result);
                return result;
            })
            .catch(function(err){
                if (err.message === "HTTP_429") {
                    if (retryCount < 2) {
                        return new Promise(resolve => setTimeout(resolve, 2000))
                            .then(() => tryFallback(index, retryCount + 1));
                    } else {
                        return Promise.reject(err);
                    }
                } else if (err.message === "NOT_FOUND" || err.message === "MISMATCHED_CITY") {
                    return new Promise(resolve => setTimeout(resolve, 1000))
                        .then(() => tryFallback(index + 1, 0));
                } else {
                    return Promise.reject(err);
                }
            });
    }
    
    const promise = tryFallback(0, 0).finally(function(){
        geocodeInFlight.delete(address);
    });
    geocodeInFlight.set(address, promise);
    return promise;
}

// 【優化：動態進度提示排隊繪製】
function renderMapMarkers(data){
    if(!map) return;

    const token = ++mapRenderToken;

    mapMarkers.forEach(m => map.removeLayer(m));
    mapMarkers = [];

    const itemsWithAddress = data.filter(item => item.address);
    const mapPinCount = document.getElementById("mapPinCount");
    const mapLoading = document.getElementById("mapLoading");

    renderMapLegend(itemsWithAddress);

    if(itemsWithAddress.length === 0){
        if(mapLoading) mapLoading.style.display = "none";
        if(mapPinCount) mapPinCount.textContent = "（0 間）";
        return;
    }

    let failed = 0;
    let blurredCount = 0;
    const bounds = L.latLngBounds();

    // 【一次全跑出來】已經有快取座標的地址（多半是背景預先定位算好的），
    // 不用排隊、不用等節流，直接同步畫上地圖
    const pendingItems = [];
    itemsWithAddress.forEach(function(item){
        if(geocodeCache.has(item.address)){
            const cached = geocodeCache.get(item.address);
            if(cached.precision !== "exact") blurredCount++;
            placeMarker(item, cached);
            bounds.extend([cached.lat, cached.lng]);
        } else {
            pendingItems.push(item);
        }
    });

    applyMapTypeFilter(); // 依目前的類型篩選狀態，決定哪些圖釘要顯示，並依可見的圖釘調整地圖範圍

    // 全部地址都已經有快取，不需要再排隊查詢，直接收尾
    if(pendingItems.length === 0){
        if(mapLoading) mapLoading.style.display = "none";
        if(blurredCount > 0){
            showToast("ℹ️ 部分店家地址不全，已自動使用安全「粗略定位」修正區域");
        }
        return;
    }

    // 已經瞬間畫好的數量，讓進度文字接著往上算，分母維持這次篩選出的總店家數
    const alreadyPlacedCount = itemsWithAddress.length - pendingItems.length;

    // 還有沒查過的地址，才需要走原本「一筆一筆節流查詢」的流程
    if(mapLoading) mapLoading.style.display = "flex";

    let i = 0;
    function processNext() {
        if (token !== mapRenderToken) return;

        // 當全部跑完時
        if (i >= pendingItems.length) {
            if(mapLoading) mapLoading.style.display = "none";
            // 依目前的類型篩選狀態，決定哪些圖釘要顯示，並恢復最終（可見）標記總數
            applyMapTypeFilter();
            if(blurredCount > 0){
                showToast("ℹ️ 部分店家地址不全，已自動使用安全「粗略定位」修正區域");
            }
            if(failed > 0){
                showToast("⚠️ 有 " + failed + " 筆地址因格式問題完全無法定位");
            }
            return;
        }

        // 【關鍵優化點】：動態即時更新目前的載入進度文字 (例如：⏳ 正在定位 7 / 10 ...)
        // 分子接續「已經瞬間畫好」的數量往上算，分母固定用這次篩選出的總店家數，避免背景預先定位讓數字看起來對不上
        if(mapPinCount) {
            mapPinCount.innerHTML = `<span style="color: #e2492a; font-weight: bold;">⏳ 正在定位 ${alreadyPlacedCount + i + 1} / ${itemsWithAddress.length}</span>`;
        }

        const item = pendingItems[i];
        geocodeAddress(item.address)
            .then(function(geocodeResult){
                if(token !== mapRenderToken) return;
                
                if (geocodeResult.precision !== "exact") {
                    blurredCount++;
                }
                
                placeMarker(item, geocodeResult);
                bounds.extend([geocodeResult.lat, geocodeResult.lng]);
            })
            .catch(function(err){
                failed++;
                console.warn("定位失敗：", item.name, item.address, err.message);
            })
            .finally(function(){
                if(token !== mapRenderToken) return;
                i++;
                setTimeout(processNext, 1000);
            });
    }

    processNext();
}

// 依目前顯示在地圖上的資料，統計出現過的類型與筆數，畫出對應的顏色圖例
function renderMapLegend(items){
    const legendEl = document.getElementById("mapLegend");
    if(!legendEl) return;

    lastMapLegendItems = items || []; // 記住這批資料，之後點擊篩選類型時可以重新畫圖例

    if(!items || items.length === 0){
        legendEl.classList.remove("show");
        legendEl.innerHTML = "";
        return;
    }

    const counts = new Map(); // 類型名稱（或「未分類」）-> 筆數
    items.forEach(function(item){
        const label = item.type ? String(item.type) : "未分類";
        counts.set(label, (counts.get(label) || 0) + 1);
    });

    // 依筆數由多到少排序，常見類型排前面比較好找
    const sortedTypes = Array.from(counts.keys()).sort(function(a, b){
        return counts.get(b) - counts.get(a);
    });

    // 目前選取的篩選類型，如果換了搜尋/篩選條件後已經不存在於這批資料中，順便清掉避免卡住
    Array.from(selectedMapTypes).forEach(function(type){
        if(!counts.has(type)) selectedMapTypes.delete(type);
    });

    // 只有一種類型時，顏色差異沒有意義，不需要顯示圖例
    if(sortedTypes.length <= 1){
        selectedMapTypes.clear();
        legendEl.classList.remove("show");
        legendEl.innerHTML = "";
        return;
    }

    let html = sortedTypes.map(function(label){
        const color = label === "未分類" ? PIN_COLOR_UNCATEGORIZED : getPinColor(label);
        const isSelected = selectedMapTypes.has(label);
        const isDimmed = selectedMapTypes.size > 0 && !isSelected;
        const safeLabel = String(label).replace(/'/g, "\\'").replace(/\\/g, "\\\\");
        return '<button type="button" class="map-legend-item' +
                    (isSelected ? ' active' : '') + (isDimmed ? ' dimmed' : '') + '" ' +
                    'onclick="toggleMapTypeFilter(\'' + safeLabel + '\')" ' +
                    'title="點擊只顯示「' + escapeHtml(label) + '」，再點一次取消">' +
                    '<span class="map-legend-dot" style="background:' + color + ';"></span>' +
                    '<span>' + escapeHtml(label) + '</span>' +
                    '<span class="map-legend-count">' + counts.get(label) + '</span>' +
                '</button>';
    }).join("");

    // 有篩選中的類型時，額外顯示一個「顯示全部」按鈕方便一鍵恢復
    if(selectedMapTypes.size > 0){
        html += '<button type="button" class="map-legend-item map-legend-reset" onclick="clearMapTypeFilter()" title="清除篩選，顯示全部類型">' +
                    '↺ 顯示全部' +
                '</button>';
    }

    legendEl.innerHTML = html;
    legendEl.classList.add("show");
}

function placeMarker(item, geocodeResult){
    const typeLabel = item.type ? String(item.type) : "未分類";
    const marker = L.marker([geocodeResult.lat, geocodeResult.lng], {
        icon: getFoodPinIcon(item.type),
        title: item.name || "未命名餐廳"
    });
    marker._foodType = typeLabel; // 記住這個圖釘的類型，篩選時用來判斷要不要顯示
    marker.bindPopup(buildInfoWindowHtml(item, geocodeResult));
    if(isMapTypeVisible(typeLabel)){
        marker.addTo(map);
    }
    mapMarkers.push(marker);
}

/* =============================== 地圖圖例類型篩選 ================================ */
// 判斷某個類型目前是否該顯示：篩選集合為空 = 全部顯示；否則只顯示有被選取的類型
function isMapTypeVisible(typeLabel){
    return selectedMapTypes.size === 0 || selectedMapTypes.has(typeLabel);
}

// 依目前的篩選狀態，把已經畫在地圖上的圖釘逐一顯示/隱藏（不需要重新定位地址，速度很快）
function applyMapTypeFilter(){
    if(!map) return;

    const bounds = L.latLngBounds();
    let visibleCount = 0;

    mapMarkers.forEach(function(marker){
        const visible = isMapTypeVisible(marker._foodType);
        if(visible){
            if(!map.hasLayer(marker)) marker.addTo(map);
            bounds.extend(marker.getLatLng());
            visibleCount++;
        } else if(map.hasLayer(marker)){
            map.removeLayer(marker);
        }
    });

    const mapPinCount = document.getElementById("mapPinCount");
    if(mapPinCount) mapPinCount.textContent = "（" + visibleCount + " 間）";

    if(visibleCount > 0){
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
}

// 點擊圖例中的某個類型：切換該類型的篩選狀態（可複選，再點一次取消）
function toggleMapTypeFilter(typeLabel){
    if(selectedMapTypes.has(typeLabel)){
        selectedMapTypes.delete(typeLabel);
    } else {
        selectedMapTypes.add(typeLabel);
    }
    applyMapTypeFilter();
    renderMapLegend(lastMapLegendItems); // 重新畫圖例，更新每個類型的選取／淡化樣式
}

// 清除篩選，恢復顯示全部類型
function clearMapTypeFilter(){
    selectedMapTypes.clear();
    applyMapTypeFilter();
    renderMapLegend(lastMapLegendItems);
}

function buildInfoWindowHtml(item, geocodeResult){
    const isFav = favoriteNames.has(String(item.name));
    let html = '<div class="map-info">';
    
    if (geocodeResult && geocodeResult.precision !== "exact") {
        let label = "模糊定位";
        if (geocodeResult.precision === "street") label = "路段定位";
        if (geocodeResult.precision === "district") label = "行政區中心";
        if (geocodeResult.precision === "city") label = "縣市中心";
        
        html += '<div style="background-color: #fff3cd; color: #856404; font-size: 11px; padding: 4px 8px; border-radius: 4px; margin-bottom: 8px; text-align: center; border: 1px solid #ffeeba; font-weight: bold;">';
        html += '⚠️ ' + label + ' (無確切門牌位置)';
        html += '</div>';
    }

    html += '<div class="map-info-name">' + (isFav ? "★ " : "") + escapeHtml(item.name || "未命名餐廳") + "</div>";
    if(item.type){
        html += '<div class="map-info-type">🏷️ ' + escapeHtml(item.type) + "</div>";
    }
    if(item.rating){
        let score = Number(item.rating);
        score = Math.min(Math.max(score, 1), 5);
        html += '<div class="map-info-rating">' + "★".repeat(score) + "☆".repeat(5-score) + "</div>";
    }
    html += '<div class="map-info-address">📍 ' + escapeHtml(item.address) + "</div>";
    if(item.note){
        html += '<div class="map-info-note">' + escapeHtml(item.note) + "</div>";
    }
    if(item.link){
        html += '<a class="map-info-link" href="' + escapeHtml(item.link) + '" target="_blank">🔗 查看相關網頁</a>';
    }
    html += "</div>";
    return html;
}