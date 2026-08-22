/* =============================================================
   filters.js — 地區／類型篩選列 ＋ 搜尋篩選邏輯
   內容：REGIONS、detectRegion()、getRegionColor()、
         renderRegionFilters()、renderTypeFilters()、filterFood()
============================================================= */

/* =============================== 地區篩選 ================================ */
// 依照台灣行政區順序排列，順序也會決定篩選列上標籤的排列順序
const REGIONS = [
    "臺北市","新北市","桃園市","臺中市","臺南市","高雄市",
    "基隆市","新竹市","嘉義市",
    "新竹縣","苗栗縣","彰化縣","南投縣","雲林縣","嘉義縣",
    "屏東縣","宜蘭縣","花蓮縣","臺東縣","澎湖縣","金門縣","連江縣"
];
let selectedRegions = new Set(); // 空集合代表「全部地區」都顯示
let selectedTypes = new Set(); // 空集合代表「全部類型」都顯示；跟地區篩選可以同時使用（交集），例如「臺北」+「小吃」

/* =============================== 觸控點擊動畫 ================================
   手機上點擊標籤後，renderRegionFilters()/renderTypeFilters() 會整排重繪，
   舊元素連同 CSS :active 狀態一起被換掉，加上手指本身擋住該處，
   使用者幾乎感受不到點擊回饋。這裡改成：點擊當下記錄「是哪一顆標籤」，
   重繪出新元素後，找到對應的那一顆主動補上 .chip-tap class，
   用 keyframes 動畫從頭完整播出一次縮放效果，不依賴 :active 是否還留著。
   只在沒有滑鼠 hover 能力的觸控裝置上啟用，滑鼠版維持原本 hover/active 邏輯。 */
function isTouchOnlyDevice(){
    return !window.matchMedia("(hover:hover) and (pointer:fine)").matches;
}
let pendingTapKey = null;
function markChipTap(key){
    if(isTouchOnlyDevice()) pendingTapKey = key;
}
function playChipTapIfPending(chipEl, key){
    if(pendingTapKey === null || pendingTapKey !== key) return;
    pendingTapKey = null;
    chipEl.classList.add("chip-tap");
    chipEl.addEventListener("animationend", function(){
        chipEl.classList.remove("chip-tap");
    }, { once:true });
}

// 從地址字串判斷屬於哪個地區（"台" / "臺" 兩種寫法都能辨識）
function detectRegion(address){
    if(!address) return null;
    const normalized = String(address).replace(/台/g, "臺");
    for(const region of REGIONS){
        if(normalized.includes(region)) return region;
    }
    return null;
}

// 依地區在 REGIONS 陣列中的順序，產生色相平均分布、彼此好分辨的顏色
// 這裡只回傳「單一代表色」（--tag-color），實際要用在淺色卡片還是深色卡片上，
// 交給 style.css 用 color-mix() 跟目前主題的 --card / --text 混合決定深淺，
// 這樣切換主題（例如夜幕黑調）時，標籤顏色會自動跟著變深/變淺，不用重新產生 DOM
// 也不會有「淺色底標籤」在深色卡片上發亮、看不清楚的問題
function getRegionColor(region){
    const index = REGIONS.indexOf(region);
    const hue = index === -1 ? 222 : Math.round((360 / REGIONS.length) * index);
    return { color: `hsl(${hue}, 62%, 48%)` };
}

// 依目前資料中實際出現過的地區，重新畫出篩選列（含「全部地區」按鈕）
function renderRegionFilters(){
    const bar = document.getElementById("regionFilterBar");
    if(!bar) return;

    const presentRegions = REGIONS.filter(region=>
        allFoodData.some(item => detectRegion(item.address) === region)
    );

    bar.innerHTML = "";

    if(presentRegions.length === 0){
        bar.style.display = "none";
        return;
    }
    bar.style.display = "flex";

    const label = document.createElement("span");
    label.className = "filter-bar-label";
    label.textContent = "";
    bar.appendChild(label);

    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "region-chip all-chip" + (selectedRegions.size === 0 ? " active" : "");
    allChip.textContent = "全部地區";
    allChip.onclick = function(){
        markChipTap("region:all");
        selectedRegions.clear();
        renderRegionFilters();
        filterFood();
    };
    playChipTapIfPending(allChip, "region:all");
    bar.appendChild(allChip);

    presentRegions.forEach(region=>{
        const colors = getRegionColor(region);
        const isActive = selectedRegions.has(region);

        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "region-chip" + (isActive ? " active" : "");
        chip.style.setProperty("--chip-text", colors.color);
        chip.textContent = region;
        chip.onclick = function(){
            markChipTap("region:" + region);
            if(selectedRegions.has(region)){
                selectedRegions.delete(region);
            } else {
                selectedRegions.add(region);
            }
            renderRegionFilters();
            filterFood();
        };
        playChipTapIfPending(chip, "region:" + region);
        bar.appendChild(chip);
    });
}

/* =============================== 類型篩選 ================================ */
// 依目前資料中實際出現過的類型，重新畫出篩選列（含「全部類型」按鈕）
// 跟地區篩選列可以同時使用：兩邊都選了的話，篩選結果是「符合其中一個已選地區」且「符合其中一個已選類型」的交集
// 例如選「臺北市」+「小吃」，只會列出台北的小吃店
function renderTypeFilters(){
    const bar = document.getElementById("typeFilterBar");
    if(!bar) return;

    // 統計目前資料中，每個類型各出現幾次，順便決定排序（常見類型排前面）
    const counts = new Map();
    allFoodData.forEach(function(item){
        if(!item.type) return;
        const label = String(item.type);
        counts.set(label, (counts.get(label) || 0) + 1);
    });
    const presentTypes = Array.from(counts.keys()).sort(function(a, b){
        return counts.get(b) - counts.get(a);
    });

    bar.innerHTML = "";

    if(presentTypes.length === 0){
        bar.style.display = "none";
        return;
    }
    bar.style.display = "flex";

    const label = document.createElement("span");
    label.className = "filter-bar-label";
    label.textContent = "";
    bar.appendChild(label);

    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "region-chip all-chip" + (selectedTypes.size === 0 ? " active" : "");
    allChip.textContent = "全部類型";
    allChip.onclick = function(){
        markChipTap("type:all");
        selectedTypes.clear();
        renderTypeFilters();
        filterFood();
    };
    playChipTapIfPending(allChip, "type:all");
    bar.appendChild(allChip);

    presentTypes.forEach(type=>{
        // 跟地圖圖釘/圖例用同一套配色邏輯（getPinColor），同一個類型無論在地圖還是首頁篩選列，顏色都一致
        const color = getPinColor(type);
        const isActive = selectedTypes.has(type);

        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "region-chip" + (isActive ? " active" : "");
        chip.style.setProperty("--chip-text", color);
        chip.textContent = type;
        chip.onclick = function(){
            markChipTap("type:" + type);
            if(selectedTypes.has(type)){
                selectedTypes.delete(type);
            } else {
                selectedTypes.add(type);
            }
            renderTypeFilters();
            filterFood();
        };
        playChipTapIfPending(chip, "type:" + type);
        bar.appendChild(chip);
    });
}

/* =============================== 排序 ================================ */
// 每個排序方式一個 compare 函式，供 Array.sort() 使用；分數/時間相同時，
// 用店名當第二順位排序依據，結果才會是穩定、可預期的順序，不會因為原始資料順序不同而跳來跳去
const SORT_OPTIONS = {
    name: {
        compare: function(a, b){
            return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
        }
    },
    ratingDesc: {
        compare: function(a, b){
            const ra = Number(a.rating) || 0;
            const rb = Number(b.rating) || 0;
            if(rb !== ra) return rb - ra;
            return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
        }
    },
    ratingAsc: {
        compare: function(a, b){
            const ra = Number(a.rating) || 0;
            const rb = Number(b.rating) || 0;
            if(ra !== rb) return ra - rb;
            return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
        }
    },
    updatedDesc: {
        compare: function(a, b){
            const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            if(tb !== ta) return tb - ta;
            return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
        }
    },
    updatedAsc: {
        compare: function(a, b){
            const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            if(ta !== tb) return ta - tb;
            return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
        }
    },
    region: {
        compare: function(a, b){
            const ia = REGIONS.indexOf(detectRegion(a.address));
            const ib = REGIONS.indexOf(detectRegion(b.address));
            const posA = ia === -1 ? REGIONS.length : ia;
            const posB = ib === -1 ? REGIONS.length : ib;
            if(posA !== posB) return posA - posB;
            return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
        }
    },
    // 「離我最近」：距離由 map.js 的 getFoodItemDistanceKm() 計算（需要使用者定位 + 店家座標）。
    // 還沒定位到（或該店家還沒有座標）一律視為 Infinity 公里，自動排到最後面，不會整個排序中斷。
    distance: {
        compare: function(a, b){
            const da = getFoodItemDistanceKm(a);
            const db = getFoodItemDistanceKm(b);
            if(da !== db) return da - db;
            return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
        }
    }
};

// 排序下拉選單（見 index.html 的 #sortSelect）onchange 時呼叫
function setSortOrder(value){
    sortBy = SORT_OPTIONS[value] ? value : "updatedDesc";
    filterFood();
}

/* =============================== 搜尋 ================================ */
function filterFood(){
    const keyword = document.getElementById("searchInp").value.toLowerCase();
    const result = allFoodData.filter(item=>{
        // 用 String() 轉型，避免店名/類型/地址被 Google 試算表存成數字（例如店名輸入「950」）時
        // 直接呼叫 .toLowerCase() 而噴出例外，導致整個清單「載入失敗」
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
    result.sort((SORT_OPTIONS[sortBy] || SORT_OPTIONS.updatedAsc).compare);
    renderList(result);
    if(isMapView) renderMapMarkers(result); // 地圖打開時，搜尋/篩選也要同步更新圖釘
}
