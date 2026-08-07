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
    ⚠️ API 金鑰不放在前端，改由後端 (.gs 的 geocodeBatch action) 代打 LocationIQ，
       金鑰只存在 Google Apps Script 的「指令碼屬性」裡，瀏覽器端看不到。
       地址會一批一批送到後端，備援重試跟節流都在後端同一次執行裡完成，
       盡量避免每家店都要各自付一次 GAS 冷啟動的等待時間。
============================================================= */

let isMapView = false;
let map = null;
let mapMarkers = [];
let mapRenderToken = 0; // 防止舊查詢結果蓋掉新篩選
let selectedMapTypes = new Set(); // 空集合代表「全部類型」都顯示；點擊圖例可篩選只顯示特定類型的圖釘
let lastMapLegendItems = []; // 記住目前這批地圖資料，篩選類型時可以重新畫圖例而不用重新定位
const geocodeCache = new Map(); // 地址 -> {lat, lng, precision}

/* =============================================================
    定位結果存到裝置上（localStorage）
    地址一旦定位過，座標幾乎不會變，沒必要每次重新打開網頁都重查一次
    （尤其是久久沒開網頁時，逐筆重新定位會等很久）。這裡把 geocodeCache
    也同步存一份在裝置的 localStorage，下次開啟網頁時先讀回來直接用；
    只有在使用者新增／編輯地址／刪除店家時，才會讓對應那一筆的快取失效，
    逼它下次重新查詢、重新存檔（見 invalidateGeocodeCache() / pruneGeocodeCache()）。
============================================================= */
const GEOCODE_CACHE_STORAGE_KEY = "foodAppGeocodeCache";

function loadGeocodeCacheFromStorage(){
    try {
        const raw = localStorage.getItem(GEOCODE_CACHE_STORAGE_KEY);
        if(!raw) return;
        const saved = JSON.parse(raw);
        Object.keys(saved).forEach(function(address){
            geocodeCache.set(address, saved[address]);
        });
    } catch(e){
        // 讀取失敗（例如儲存的格式壞掉）就當作沒有快取，之後照原本的流程重新查詢即可
        console.warn("讀取裝置上的定位快取失敗，將重新查詢：", e.message);
    }
}
loadGeocodeCacheFromStorage();

// 短暫防抖：背景預先定位常常一次寫入好幾十筆，避免每定位到一筆就存一次裝置儲存
let geocodeCacheSaveTimer = null;
function persistGeocodeCache(){
    clearTimeout(geocodeCacheSaveTimer);
    geocodeCacheSaveTimer = setTimeout(function(){
        try {
            const plain = {};
            geocodeCache.forEach(function(value, key){ plain[key] = value; });
            localStorage.setItem(GEOCODE_CACHE_STORAGE_KEY, JSON.stringify(plain));
        } catch(e){
            // 無痕模式、瀏覽器封鎖，或裝置儲存空間已滿時安靜地忽略——
            // 這次的定位結果還是留在記憶體裡，這一頁分頁一樣能正常使用地圖，
            // 只是下次重新整理網頁時得再查一次
            console.warn("儲存定位快取到裝置失敗：", e.message);
        }
    }, 400);
}

// 讓某個地址的快取（記憶體 + 裝置儲存）失效，之後再查詢這個地址時會強制重新定位
// 用在：使用者編輯店家、把地址改掉的時候（見 food-crud.js 的 updateFoodData）
function invalidateGeocodeCache(address){
    if(!address) return;
    if(geocodeCache.delete(address)){
        persistGeocodeCache();
    }
}

// 清掉「目前資料裡已經沒有任何店家在用」的快取地址（例如店家被刪除、或地址被改掉後留下的舊快取），
// 避免裝置儲存的快取無限長大。每次資料重新載入、要開始背景預先定位之前會呼叫一次
function pruneGeocodeCache(){
    const usedAddresses = new Set(
        allFoodData.map(function(item){ return item.address; }).filter(Boolean)
    );
    let changed = false;
    Array.from(geocodeCache.keys()).forEach(function(address){
        if(!usedAddresses.has(address)){
            geocodeCache.delete(address);
            changed = true;
        }
    });
    if(changed) persistGeocodeCache();
}

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

        // 左下角的類型圖例（.map-legend）要避開 Leaflet 版權宣告，但版權宣告的實際高度
        // 不是固定的：裝置寬度、字型載入時機不同，有時候擠成一行，有時候兩行、甚至三行，
        // 沒辦法寫死一個固定間距去賭它一定長怎樣。這裡用 ResizeObserver 即時量測版權宣告
        // 目前實際佔用的高度，動態寫成 CSS 變數，圖例的位置（見 style.css 的 .map-legend）
        // 就會自動跟著版權宣告目前的實際高度走，不管它變成幾行都不會重疊
        const attributionEl = map.attributionControl.getContainer();
        if("ResizeObserver" in window && attributionEl){
            const attributionObserver = new ResizeObserver(function(entries){
                const height = entries[0].contentRect.height;
                document.documentElement.style.setProperty("--leaflet-attribution-height", height + "px");
            });
            attributionObserver.observe(attributionEl);
        }
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
    // 每次資料重新載入（新增/編輯/刪除後）都會呼叫這裡
    ++backgroundPrefetchToken;

    // 先清掉「現在資料裡已經沒有店家在用」的快取（例如剛被刪除的店家），保持裝置上的快取乾淨
    pruneGeocodeCache();

    const mapViewBtn = document.getElementById("mapViewBtn");
    const addresses = allFoodData.map(function(item){ return item.address; }).filter(Boolean);
    const hasMissing = addresses.some(function(addr){ return !geocodeCache.has(addr); });

    // 還有地址沒定位過，先把「地圖檢視」鎖起來，避免使用者點進去看到還在轉圈圈，
    // 以為是功能壞掉了；如果全部都已經有快取（例如剛從裝置讀回來），就不用鎖，直接可點
    if(mapViewBtn){
        if(hasMissing){
            mapViewBtn.disabled = true;
        } else if(!isMapView){
            // isMapView 開著的時候，讓 renderMapMarkers() 自己的流程決定按鈕狀態，這裡不插手
            mapViewBtn.disabled = false;
        }
    }

    geocodeMissingAddresses(addresses).catch(function(err){
        console.warn("背景預先定位失敗：", err && err.message);
    }).finally(function(){
        if(mapViewBtn && !isMapView) mapViewBtn.disabled = false;
    });
}

/* =============================================================
    批次地理編碼
    以前是「一個地址、發一次 request」：一個地址如果查不到，還要在前端自己
    逐步放寬（去社區名→去門牌→去巷弄→行政區→縣市）逐一重試，等於一家店可能
    要來回打好幾次 Google Apps Script。GAS 網頁應用程式沒有「一直保持熱機」
    這回事，每次呼叫幾乎都可能重新冷啟動，一家店的定位因此常常要多付好幾次
    冷啟動的等待時間。

    現在改成把「一批地址」一次送給後端（見 程式碼.gs 的 geocodeBatchViaLocationIQ），
    地址的備援重試、跟 LocationIQ 之間的節流全部搬到後端、在同一次 GAS 執行裡面做完，
    前端只需要付一次冷啟動的代價，不管這批裡面有幾家店。
============================================================= */
const GEOCODE_BATCH_SIZE = 20; // 跟 程式碼.gs 的 GEOCODE_BATCH_MAX_SIZE 對應
let geocodeBatchInFlight = null; // 目前正在跑的批次查詢，讓背景預先定位跟地圖畫面不會搶著查同一批地址

// 把 addresses 裡「還沒有快取」的地址切成一批一批送給後端查詢，查到的結果會存進 geocodeCache
// 並同步存到裝置（localStorage）。onProgress(doneCount, totalCount) 可用來更新畫面上的進度文字
function geocodeMissingAddresses(addresses, onProgress){
    const unique = Array.from(new Set((addresses || []).filter(function(addr){
        return addr && !geocodeCache.has(addr);
    })));

    if(unique.length === 0) return Promise.resolve();

    // 如果已經有一批在跑（例如背景預先定位跟地圖畫面幾乎同時觸發），先排隊等它做完，
    // 而不是兩邊各自送出一批可能重疊的查詢
    const waitForPrevious = geocodeBatchInFlight ? geocodeBatchInFlight.catch(function(){}) : Promise.resolve();

    const run = waitForPrevious.then(function(){
        const chunks = [];
        for(let i = 0; i < unique.length; i += GEOCODE_BATCH_SIZE){
            chunks.push(unique.slice(i, i + GEOCODE_BATCH_SIZE));
        }

        let doneCount = 0;
        return chunks.reduce(function(promise, chunk){
            return promise.then(function(){
                // 送出前再濾一次：如果排隊等待期間，前一批剛好也查到了這批裡的某些地址，就不用重查
                const stillMissing = chunk.filter(function(addr){ return !geocodeCache.has(addr); });
                if(stillMissing.length === 0){
                    doneCount += chunk.length;
                    if(onProgress) onProgress(doneCount, unique.length);
                    return;
                }
                return apiPost("geocodeBatch", { addresses: stillMissing }, { retryCount: 1 })
                    .then(function(response){
                        const results = (response && response.results) || {};
                        stillMissing.forEach(function(addr){
                            const item = results[addr];
                            if(item && !item.error){
                                geocodeCache.set(addr, item);
                            }
                            // 有 error 的地址（NOT_FOUND / MISMATCHED_CITY 等）不快取，
                            // 留給呼叫端（renderMapMarkers）自己統計失敗筆數並顯示提示
                        });
                        persistGeocodeCache();
                    })
                    .catch(function(err){
                        console.warn("批次定位查詢失敗：", err && err.message, stillMissing);
                    })
                    .finally(function(){
                        doneCount += chunk.length;
                        if(onProgress) onProgress(doneCount, unique.length);
                    });
            });
        }, Promise.resolve());
    });

    geocodeBatchInFlight = run.finally(function(){
        if(geocodeBatchInFlight === run) geocodeBatchInFlight = null;
    });
    return geocodeBatchInFlight;
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

    // 還有沒查過的地址，才需要送去後端一次查完
    if(mapLoading) mapLoading.style.display = "flex";

    const addressesToFetch = pendingItems.map(function(item){ return item.address; });

    geocodeMissingAddresses(addressesToFetch, function(done, total){
        if(token !== mapRenderToken) return;
        // 【進度提示】改成以「批次」為單位更新（例如 20 家一批），不再是查到一家就跳一格，
        // 但同一批裡的每一家還是會在整批查完的當下一起瞬間畫上地圖
        if(mapPinCount){
            mapPinCount.innerHTML = `<span style="color: #e2492a; font-weight: bold;">⏳ 正在定位 ${alreadyPlacedCount + done} / ${itemsWithAddress.length}</span>`;
        }
    }).then(function(){
        if(token !== mapRenderToken) return;

        pendingItems.forEach(function(item){
            if(geocodeCache.has(item.address)){
                const cached = geocodeCache.get(item.address);
                if(cached.precision !== "exact") blurredCount++;
                placeMarker(item, cached);
                bounds.extend([cached.lat, cached.lng]);
            } else {
                failed++;
                console.warn("定位失敗：", item.name, item.address);
            }
        });

        if(mapLoading) mapLoading.style.display = "none";
        // 依目前的類型篩選狀態，決定哪些圖釘要顯示，並恢復最終（可見）標記總數
        applyMapTypeFilter();
        if(blurredCount > 0){
            showToast("ℹ️ 部分店家地址不全，已自動使用安全「粗略定位」修正區域");
        }
        if(failed > 0){
            showToast("⚠️ 有 " + failed + " 筆地址因格式問題完全無法定位");
        }
    });
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