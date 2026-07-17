/* =============================================================
    後端 API 設定
    部署 .gs 為「網頁應用程式」(Web App) 後，把 /exec 結尾的網址貼在這裡。
    這份 HTML 不再依賴 google.script.run，而是用標準 fetch() 呼叫，
    所以可以直接嵌入 Google Sites，也可以單獨用瀏覽器打開。
============================================================= */
const CONFIG = {
    API_URL: "https://script.google.com/macros/s/AKfycbzFiQLO8g9FZrnfDxPZJFkIE5ccJ5UnrvJ86V5EKJUPwR74xnmgoobpjGBUc_E_DNVZ/exec"
};

/* 讀取類 API：用 GET + query string，方便快取/除錯 */
function apiGet(action, params){
    const url = new URL(CONFIG.API_URL);
    url.searchParams.set("action", action);
    Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
    return fetch(url.toString())
        .then(res => res.json())
        .then(json => {
            if (json && json.error) throw new Error(json.error);
            return json;
        });
}

/* 寫入類 API：用 POST，body 是 JSON 字串。
    Content-Type 刻意用 text/plain，避免瀏覽器送出 CORS 預檢請求（OPTIONS），
    因為 Apps Script 的 Web App 預設不處理 OPTIONS。 */
function apiPost(action, data){
    return fetch(CONFIG.API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, data })
    })
        .then(res => res.json())
        .then(json => {
            if (json && json.error) throw new Error(json.error);
            return json;
        });
}

let allFoodData = [];
let favoriteNames = new Set();
let showFavoritesOnly = false;
let editingRowNum = null; // null代表目前是「新增」模式，有值代表正在編輯該列資料

/* =============================== 地區篩選 ================================ */
// 依照台灣行政區順序排列，順序也會決定篩選列上標籤的排列順序
const REGIONS = [
    "臺北市","新北市","桃園市","臺中市","臺南市","高雄市",
    "基隆市","新竹市","嘉義市",
    "新竹縣","苗栗縣","彰化縣","南投縣","雲林縣","嘉義縣",
    "屏東縣","宜蘭縣","花蓮縣","臺東縣","澎湖縣","金門縣","連江縣"
];
let selectedRegions = new Set(); // 空集合代表「全部地區」都顯示

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
function getRegionColor(region){
    const index = REGIONS.indexOf(region);
    if(index === -1){
        return { bg: "#f1f2ff", text: "#636e72" };
    }
    const hue = Math.round((360 / REGIONS.length) * index);
    return {
        bg: `hsl(${hue}, 75%, 93%)`,
        text: `hsl(${hue}, 55%, 36%)`
    };
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

    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "region-chip all-chip" + (selectedRegions.size === 0 ? " active" : "");
    allChip.textContent = "全部地區";
    allChip.onclick = function(){
        selectedRegions.clear();
        renderRegionFilters();
        filterFood();
    };
    bar.appendChild(allChip);

    presentRegions.forEach(region=>{
        const colors = getRegionColor(region);
        const isActive = selectedRegions.has(region);

        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "region-chip" + (isActive ? " active" : "");
        chip.style.setProperty("--chip-text", colors.text);
        chip.textContent = region;
        chip.onclick = function(){
            if(selectedRegions.has(region)){
                selectedRegions.delete(region);
            } else {
                selectedRegions.add(region);
            }
            renderRegionFilters();
            filterFood();
        };
        bar.appendChild(chip);
    });
}

/* =============================== 時間格式化 ================================ */
// 把 ISO 時間字串轉成「YYYY/MM/DD HH:mm」的顯示格式
function formatDateTime(value){
    if(!value) return "";
    const d = new Date(value);
    if(isNaN(d.getTime())) return "";
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* =============================== 風格色調切換 ================================ */
const THEMES = {
    sunset:   { label: "夕陽楓紅", color: "#e2492a" },
    ocean:    { label: "海洋藍調", color: "#2f6fbf" },
    forest:   { label: "森林抹茶", color: "#3f8556" },
    berry:    { label: "莓果粉紫", color: "#c23a72" },
    charcoal: { label: "質感灰調", color: "#4a4a52" }
};
const DEFAULT_THEME = "sunset";

function setTheme(themeName){
    if(!THEMES[themeName]) themeName = DEFAULT_THEME;

    document.documentElement.setAttribute("data-theme", themeName);

    // 更新手機瀏覽器網址列/工作列的主題色，跟畫面主色保持一致
    const metaThemeColor = document.getElementById("themeColorMeta");
    if(metaThemeColor) metaThemeColor.setAttribute("content", THEMES[themeName].color);

    // 記住這次選擇，下次造訪自動套用
    try {
        localStorage.setItem("foodAppTheme", themeName);
    } catch(e){ /* 無痕模式或瀏覽器封鎖 localStorage 時，安靜地忽略，這次選擇就只在當前分頁生效 */ }

    // 同步畫面上色票的選中狀態
    document.querySelectorAll(".theme-swatch").forEach(function(btn){
        btn.classList.toggle("active", btn.dataset.theme === themeName);
    });

    showToast("🎨 已套用「" + THEMES[themeName].label + "」風格");
}

// 頁面載入時，把畫面上的色票狀態同步成目前生效中的主題（不彈提示、不重複寫入 localStorage）
function initThemePicker(){
    const currentTheme = document.documentElement.getAttribute("data-theme") || DEFAULT_THEME;
    document.querySelectorAll(".theme-swatch").forEach(function(btn){
        btn.classList.toggle("active", btn.dataset.theme === currentTheme);
    });
    const metaThemeColor = document.getElementById("themeColorMeta");
    if(metaThemeColor && THEMES[currentTheme]) metaThemeColor.setAttribute("content", THEMES[currentTheme].color);
}

/* =============================== 初始化 ================================ */
window.onload = function(){
    loadFood();
    loadFavorites();
    loadTypeOptions();
    initSmokeCursor();
    initThemePicker();
};

/* =============================== 滑鼠煙霧尾迹 ================================ */
const FOOD_EMOJIS = ["🍜","🍣","🍕","🍔","🍰","🍩","🍤","🥐","🍎","🍇","🍙","🧋"];

function initSmokeCursor(){
    // 只在「有滑鼠」的裝置上啟用（觸控裝置滑動屬於捲動，不需要這個效果），
    // 且尊重使用者的「減少動態效果」系統設定
    const hasFinePointer = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
    const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if(!hasFinePointer || prefersReducedMotion) return;

    let lastX = null;
    let lastY = null;
    let lastSpawn = 0;
    let activeParticles = 0;
    const MAX_PARTICLES = 40;     // 同時存在的煙霧數量上限，避免效能問題
    const MIN_INTERVAL = 35;      // 兩次產生煙霧之間至少間隔的毫秒數
    const MIN_DISTANCE = 6;       // 滑鼠至少移動這麼多像素才產生新煙霧

    document.addEventListener("mousemove", function(e){
        const now = performance.now();
        if(lastX !== null){
            const dist = Math.hypot(e.clientX - lastX, e.clientY - lastY);
            if(dist < MIN_DISTANCE || now - lastSpawn < MIN_INTERVAL) return;
        }
        lastX = e.clientX;
        lastY = e.clientY;
        lastSpawn = now;

        if(activeParticles >= MAX_PARTICLES) return;
        activeParticles++;
        spawnSmokeParticle(e.clientX, e.clientY, function(){
            activeParticles--;
        });
    }, { passive:true });
}

function spawnSmokeParticle(x, y, onDone){
    const particle = document.createElement("div");
    particle.className = "smoke-particle";
    particle.textContent = FOOD_EMOJIS[Math.floor(Math.random() * FOOD_EMOJIS.length)];

    const size = 14 + Math.random() * 10;
    const offsetX = (Math.random() - 0.5) * 10;
    const offsetY = (Math.random() - 0.5) * 10;
    const drift = (Math.random() - 0.5) * 26; // 上升過程中的左右飄移幅度
    const rotate = (Math.random() - 0.5) * 50; // 上升過程中的旋轉角度

    particle.style.fontSize = size + "px";
    particle.style.setProperty("--sx", (x - size / 2 + offsetX) + "px");
    particle.style.setProperty("--sy", (y - size / 2 + offsetY) + "px");
    particle.style.setProperty("--dx", drift + "px");
    particle.style.setProperty("--rot", rotate + "deg");

    document.body.appendChild(particle);
    particle.addEventListener("animationend", function(){
        particle.remove();
        if(onDone) onDone();
    }, { once:true });
}

/* =============================== 讀取我的最愛清單 ================================ */
function loadFavorites(){
    apiGet("getFavorites")
        .then(function(names){
            favoriteNames = new Set(names || []);
            filterFood(); // 依目前的搜尋字串/篩選狀態重新渲染，套用最愛標記
        })
        .catch(function(error){
            console.error("讀取我的最愛失敗：", error);
        });
}

/* =============================== 切換「只看最愛」篩選 ================================ */
function toggleFavFilter(){
    showFavoritesOnly = !showFavoritesOnly;
    document.getElementById("favFilterBtn").classList.toggle("active", showFavoritesOnly);
    filterFood();
}

/* =============================== 切換單一店家的最愛狀態 ================================ */
function toggleFavoriteItem(name, btnEl){
    if(btnEl.disabled) return; // 請求處理中，避免快速連點造成重複請求
    btnEl.disabled = true;

    // 統一轉成字串：後端 getFavorites() 回傳的都是字串，
    // 但店名若在試算表被存成數字型態，item.name 會是數字，直接比對會一直對不上
    name = String(name);

    const wasFavorite = favoriteNames.has(name);

    // 先在畫面上樂觀更新，體感更即時
    if(wasFavorite){
        favoriteNames.delete(name);
    } else {
        favoriteNames.add(name);
    }
    btnEl.classList.toggle("active", !wasFavorite);
    btnEl.textContent = !wasFavorite ? "★" : "☆";

    apiPost("toggleFavorite", { name: name })
        .then(function(){
            btnEl.disabled = false;
        })
        .catch(function(error){
            // 失敗就復原畫面狀態
            if(wasFavorite){
                favoriteNames.add(name);
            } else {
                favoriteNames.delete(name);
            }
            btnEl.classList.toggle("active", wasFavorite);
            btnEl.textContent = wasFavorite ? "★" : "☆";
            btnEl.disabled = false;
            showToast("更新最愛失敗，請再試一次");
            console.error(error);
        });

    // 若目前正在「只看最愛」篩選模式下取消收藏，要把卡片從畫面移除
    if(showFavoritesOnly){
        filterFood();
    }
}

/* =============================== 讀取類型選項（來自「類型設定」工作表） ================================ */
function loadTypeOptions(){
    apiGet("getTypeOptions")
        .then(function(options){
            populateTypeSelect("type", options);
            populateTypeSelect("m-type", options);
        })
        .catch(function(error){
            console.error("讀取類型選項失敗：", error);
        });
}

/* 把選項清單填入指定的 select（保留原本的「請選擇類型」提示） */
function populateTypeSelect(selectId, options){
    const select = document.getElementById(selectId);
    if(!select) return;

    // 移除除了第一個提示選項以外的舊選項，避免重複載入
    while(select.options.length > 1){
        select.remove(1);
    }

    (options || []).forEach(function(typeName){
        const opt = document.createElement("option");
        opt.value = typeName;
        opt.textContent = typeName;
        select.appendChild(opt);
    });
}

/* =============================== 讀取資料 ================================ */
function loadFood(){
    const container = document.getElementById("foodContainer");
    container.innerHTML = `
        <div class="loading">
            正在載入美食收藏...
        </div>
    `;
    apiGet("getFoodList")
        .then(function(data){
            allFoodData = data || [];
            updateCount();
            renderRegionFilters();
            filterFood();
            prefetchGeocodesInBackground();
        })
        .catch(function(error){
            container.innerHTML = `
                <div class="empty">
                    ⚠️
                    <h3>載入失敗</h3>
                    <p>請確認 CONFIG.API_URL 是否已正確設定</p>
                </div>
            `;
            console.error("讀取美食清單失敗：", error);
        });
}

/* =============================== 更新數量 ================================ */
function updateCount(){
    const count = document.getElementById("foodCount");
    if(count){
        count.innerText = allFoodData.length;
    }
}

/* =============================== Render List ================================ */
function renderList(data){
    const container = document.getElementById("foodContainer");
    container.innerHTML="";
    
    if(data.length===0){
        container.innerHTML= `
            <div class="empty">
                🍽️
                <h3> 還沒有收藏餐廳 </h3>
                <p> 開始建立你的美食地圖吧！ </p>
            </div>
        `;
        return;
    }
    
    data.forEach(item=>{
        const card = document.createElement("div");
        card.className = "food-card";
        
        /* 收藏星星 */
        const isFav = favoriteNames.has(String(item.name));
        const favBtn = document.createElement("button");
        favBtn.className = "favorite-btn" + (isFav ? " active" : "");
        favBtn.textContent = isFav ? "★" : "☆";
        favBtn.setAttribute("aria-label", "收藏此餐廳");
        favBtn.onclick = function(){
            toggleFavoriteItem(item.name, favBtn);
        };

        /* 名稱 */
        const name = document.createElement("div");
        name.className="food-name";
        name.textContent = item.name || "未命名餐廳";

        /* 標題列：星星 + 店名 */
        const headerRow = document.createElement("div");
        headerRow.className = "card-header-row";
        headerRow.appendChild(favBtn);
        headerRow.appendChild(name);
        
        /* 類型 */
        let type;
        if(item.type){
            type = document.createElement("div");
            type.className = "food-type";
            type.textContent = "🏷️ "+item.type;
        }

        /* 地區標籤（依地址判斷，不同地區給不同顏色） */
        let regionTag;
        const regionName = detectRegion(item.address);
        if(regionName){
            const colors = getRegionColor(regionName);
            regionTag = document.createElement("div");
            regionTag.className = "region-tag";
            regionTag.style.setProperty("--tag-bg", colors.bg);
            regionTag.style.setProperty("--tag-text", colors.text);
            regionTag.textContent = "📍 " + regionName;
        }

        /* 標籤列：類型 + 地區 */
        let tagRow;
        if(type || regionTag){
            tagRow = document.createElement("div");
            tagRow.className = "tag-row";
            if(type) tagRow.appendChild(type);
            if(regionTag) tagRow.appendChild(regionTag);
        }
        
        /* 星星 */
        let rating;
        if(item.rating){
            rating = document.createElement("div");
            rating.className = "rating";
            let score = Number(item.rating);
            score = Math.min( Math.max(score,1), 5 );
            rating.textContent = "★".repeat(score) + "☆".repeat(5-score);
        }
        
        /* 地址（點擊前往 Google Maps） */
        let address;
        if(item.address){
            address = document.createElement("div");
            address.className = "address";
            address.textContent = "📍 " + item.address;
            address.onclick = function() {
                const mapUrl = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(item.address);
                window.open(mapUrl, "_blank");
            };
        }

        /* 相關網頁連結 */
        let linkAnchor;
        if (item.link) {
            linkAnchor = document.createElement("a");
            linkAnchor.href = item.link;
            linkAnchor.target = "_blank"; // 另開新視窗
            linkAnchor.className = "food-link";
            linkAnchor.textContent = "🔗 查看相關網頁";
        }
        
        /* 備註 */
        let note;
        if(item.note){
            note = document.createElement("div");
            note.className = "note";
            note.textContent = item.note;
        }
        
        /* 最後更新時間 */
        let updatedTime;
        if(item.updatedAt){
            updatedTime = document.createElement("div");
            updatedTime.className = "updated-time";
            updatedTime.textContent = "🕒 最後更新：" + formatDateTime(item.updatedAt);
        }

        /* 編輯 */
        const edit = document.createElement("button");
        edit.className = "edit-btn";
        edit.textContent = "✏️";
        edit.setAttribute("aria-label", "編輯此餐廳");
        edit.onclick = ()=>editFoodItem(item);

        /* 刪除 */
        const del = document.createElement("button");
        del.className = "delete-btn";
        del.textContent = "🗑️";
        del.onclick = ()=>deleteFoodItem( item.rowNum, item.name );
        
        card.appendChild(edit);
        card.appendChild(del);
        card.appendChild(headerRow);
        if(tagRow) card.appendChild(tagRow);
        if(rating) card.appendChild(rating);
        if(address) card.appendChild(address);
        if(linkAnchor) card.appendChild(linkAnchor);
        if(note) card.appendChild(note);
        if(updatedTime) card.appendChild(updatedTime);
        

        container.appendChild(card);
    });
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
        return matchesKeyword && matchesFavorite && matchesRegion;
    });
    renderList(result);
    if(isMapView) renderMapMarkers(result); // 地圖打開時，搜尋/篩選也要同步更新圖釘
}

/* =============================== 新增 / 編輯 ================================ */
function submitFood(){
    const data = {
        name: document.getElementById("name").value,
        type: document.getElementById("type").value,
        rating: document.getElementById("rating").value,
        address: document.getElementById("address").value,
        link: document.getElementById("link").value.trim(),
        note: document.getElementById("note").value
    };

    if(editingRowNum !== null){
        const rowNum = editingRowNum;
        editingRowNum = null;
        setEditModeUI(false);
        updateFoodData(rowNum, data);
    } else {
        saveFoodData(data);
    }

    clearDesktopForm();
}

function submitMobileFood(){
    const data={
        name: document.getElementById("m-name").value,
        type: document.getElementById("m-type").value,
        rating: document.getElementById("m-rating").value,
        address: document.getElementById("m-address").value,
        link: document.getElementById("m-link").value.trim(),
        note: document.getElementById("m-note").value
    };

    if(editingRowNum !== null){
        const rowNum = editingRowNum;
        editingRowNum = null;
        setEditModeUI(false);
        updateFoodData(rowNum, data);
    } else {
        saveFoodData(data);
    }

    clearMobileForm();
}

function clearDesktopForm(){
    document.getElementById("name").value = "";
    document.getElementById("type").value = "";
    document.getElementById("rating").value = "";
    document.getElementById("address").value = "";
    document.getElementById("link").value = "";
    document.getElementById("note").value = "";
}

function clearMobileForm(){
    document.getElementById("m-name").value = "";
    document.getElementById("m-type").value = "";
    document.getElementById("m-rating").value = "";
    document.getElementById("m-address").value = "";
    document.getElementById("m-link").value = "";
    document.getElementById("m-note").value = "";
}

function saveFoodData(data){
    if(!data.name.trim()){
        showToast( "請輸入餐廳名稱" );
        return;
    }
    showToast( "正在收藏..." );
    apiPost("saveFood", data)
        .then(function(response){
            showToast( "🎉 " + (response.message || "儲存成功！") );
            document.getElementById("foodForm")?.reset();
            closeModal();
            loadFood();
        })
        .catch(function(error){
            showToast("儲存失敗，請再試一次");
            console.error(error);
        });
}

/* =============================== 更新既有資料 ================================ */
function updateFoodData(rowNum, data){
    if(!data.name.trim()){
        showToast( "請輸入餐廳名稱" );
        return;
    }
    showToast( "正在更新..." );
    apiPost("updateFood", Object.assign({ rowNum: rowNum }, data))
        .then(function(response){
            showToast( "✏️ " + (response.message || "更新成功！") );
            document.getElementById("foodForm")?.reset();
            closeModal();
            loadFood();
        })
        .catch(function(error){
            showToast("更新失敗，請再試一次");
            console.error(error);
        });
}

/* =============================== 進入 / 離開編輯模式 ================================ */
// 把選項填入 select；若該選項已不在清單裡（例如類型設定被移除），就退回提示狀態
function setSelectValue(selectId, value){
    const select = document.getElementById(selectId);
    if(!select) return;
    select.value = value || "";
    if(select.value !== (value || "")){
        select.value = "";
    }
}

// 點擊卡片上的「✏️編輯」時，把該筆資料填回表單，並切換成編輯模式
function editFoodItem(item){
    editingRowNum = item.rowNum;

    // 桌機表單
    document.getElementById("name").value = item.name || "";
    setSelectValue("type", item.type);
    document.getElementById("rating").value = item.rating || "";
    document.getElementById("address").value = item.address || "";
    document.getElementById("link").value = item.link || "";
    document.getElementById("note").value = item.note || "";

    // 手機表單
    document.getElementById("m-name").value = item.name || "";
    setSelectValue("m-type", item.type);
    document.getElementById("m-rating").value = item.rating || "";
    document.getElementById("m-address").value = item.address || "";
    document.getElementById("m-link").value = item.link || "";
    document.getElementById("m-note").value = item.note || "";

    setEditModeUI(true);
    openModal(); // 手機版：直接打開彈窗
    document.querySelector(".desktop-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// 切換表單/彈窗上的文字與「取消編輯」按鈕的顯示狀態
function setEditModeUI(isEditing){
    const desktopTitle = document.getElementById("formTitle");
    const modalTitle = document.getElementById("modalTitle");
    const desktopBtn = document.getElementById("submitBtn");
    const modalBtn = document.getElementById("modalSubmitBtn");
    const cancelBtn = document.getElementById("cancelEditBtn");
    const cancelBtnMobile = document.getElementById("cancelEditBtnMobile");

    if(desktopTitle) desktopTitle.textContent = isEditing ? "✏️ 編輯餐廳" : "✨ 新增餐廳";
    if(modalTitle) modalTitle.textContent = isEditing ? "編輯餐廳" : "新增餐廳";
    if(desktopBtn) desktopBtn.textContent = isEditing ? "更新收藏" : "收藏餐廳";
    if(modalBtn) modalBtn.textContent = isEditing ? "更新" : "收藏";
    if(cancelBtn) cancelBtn.style.display = isEditing ? "block" : "none";
    if(cancelBtnMobile) cancelBtnMobile.style.display = isEditing ? "block" : "none";
}

// 取消編輯：清空表單、重置狀態
function cancelEdit(){
    editingRowNum = null;
    setEditModeUI(false);
    clearDesktopForm();
    clearMobileForm();
}

/* =============================== Delete ================================ */
function deleteFoodItem(rowNum,name){
    if( !confirm( `確定刪除「${name}」嗎？` ) ) return;
    apiPost("deleteFood", { rowNum: rowNum })
        .then(function(response){
            favoriteNames.delete(String(name)); // 後端已同步移除收藏，前端本地狀態也一併同步
            showToast( "🗑️ 已刪除" );
            loadFood();
        })
        .catch(function(error){
            showToast("刪除失敗，請再試一次");
            console.error(error);
        });
}

/* =============================== Modal ================================ */
function openModal(){
    document.getElementById("modal").classList.add("show");
}
// 手機版點擊「＋」新增時呼叫：若原本正在編輯，先重置成新增模式，再打開彈窗
function openAddModal(){
    if(editingRowNum !== null){
        cancelEdit();
    }
    openModal();
}
function closeModal(){
    document.getElementById("modal").classList.remove("show");
    // 使用者直接關閉彈窗（沒有送出）時，一併取消編輯狀態，避免下次新增誤觸更新
    if(editingRowNum !== null){
        cancelEdit();
    }
}

/* =============================================================
    地圖檢視（Leaflet 地圖 + LocationIQ 地址查詢）
    地圖底圖：OpenStreetMap（免費、不需金鑰）
    地址轉座標：LocationIQ（免費方案：每天 5,000 次查詢、每秒 2 次）
============================================================= */
const LOCATIONIQ_CONFIG = {
    API_KEY: "pk.7e23fe6a55cfeb2456714b8ab6320827"
};

let isMapView = false;
let map = null;
let mapMarkers = [];
let mapRenderToken = 0; // 防止舊查詢結果蓋掉新篩選
const geocodeCache = new Map(); // 地址 -> {lat, lng, precision}
const geocodeInFlight = new Map(); // 地址 -> 進行中的查詢 Promise（背景預先定位和地圖畫面共用，避免同一地址被重複查詢）

// 自訂圖釘圖示
const foodPinIcon = L.divIcon({
    className: "food-map-pin",
    html: '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 34 44">' +
          '<path d="M17 0C7.6 0 0 7.6 0 17c0 12.7 17 27 17 27s17-14.3 17-27C34 7.6 26.4 0 17 0z" fill="#e2492a"/>' +
          '<circle cx="17" cy="17" r="7.5" fill="#fffbf4"/>' +
          '</svg>',
    iconSize: [30, 40],
    iconAnchor: [15, 40],
    popupAnchor: [0, -38]
});

// 點擊「🗺️ 地圖檢視」
function openMapView(){
    document.getElementById("mapView").classList.add("show");
    isMapView = true;
    document.getElementById("mapLoading").style.display = "flex";

    if(!LOCATIONIQ_CONFIG.API_KEY || LOCATIONIQ_CONFIG.API_KEY === "YOUR_LOCATIONIQ_API_KEY"){
        showToast("⚠️ 尚未設定 LocationIQ 金鑰");
        document.getElementById("mapLoading").style.display = "none";
    }

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
        return matchesKeyword && matchesFavorite && matchesRegion;
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
    if(!LOCATIONIQ_CONFIG.API_KEY || LOCATIONIQ_CONFIG.API_KEY === "YOUR_LOCATIONIQ_API_KEY") return;

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

// 送出查詢
function geocodeQuery_(query){
    const url = "https://us1.locationiq.com/v1/search?key=" + encodeURIComponent(LOCATIONIQ_CONFIG.API_KEY) +
                "&q=" + encodeURIComponent(query) + "&format=json&countrycodes=tw&limit=1";
    return fetch(url)
        .then(function(res){
            if(res.status === 404) throw new Error("NOT_FOUND");
            if(!res.ok) throw new Error("HTTP_" + res.status);
            return res.json();
        })
        .then(function(results){
            if(results && results.length > 0){
                return { 
                    lat: parseFloat(results[0].lat), 
                    lng: parseFloat(results[0].lon),
                    display_name: results[0].display_name || ""
                };
            }
            throw new Error("NOT_FOUND");
        });
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

    if(mapMarkers.length > 0){
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }

    // 全部地址都已經有快取，不需要再排隊查詢，直接收尾
    if(pendingItems.length === 0){
        if(mapLoading) mapLoading.style.display = "none";
        if(mapPinCount) mapPinCount.textContent = "（" + mapMarkers.length + " 間）";
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
            // 恢復最終標記總數
            if(mapPinCount) mapPinCount.textContent = "（" + mapMarkers.length + " 間）";
            
            if(mapMarkers.length > 0){
                map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
            }
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

function placeMarker(item, geocodeResult){
    const marker = L.marker([geocodeResult.lat, geocodeResult.lng], {
        icon: foodPinIcon,
        title: item.name || "未命名餐廳"
    }).addTo(map);
    marker.bindPopup(buildInfoWindowHtml(item, geocodeResult));
    mapMarkers.push(marker);
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

function escapeHtml(str){
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

/* =============================== Toast ================================ */
let toastTimer;
function showToast(message){
    const toast = document.getElementById("toast");
    toast.innerText = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>{
        toast.classList.remove("show");
    },2500);
}