/* =============================================================
    後端 API 設定
    部署 .gs 為「網頁應用程式」(Web App) 後，把 /exec 結尾的網址貼在這裡。
    這份 HTML 不再依賴 google.script.run，而是用標準 fetch() 呼叫，
    所以可以直接嵌入 Google Sites，也可以單獨用瀏覽器打開。
============================================================= */
const CONFIG = {
    API_URL: "https://script.google.com/macros/s/AKfycbyNNu8cEEDkMbrI7Nki4m_BeRIc53gIR7nBTMIO3BxujBG5MkB4YKHnzmncIlq8aTmN/exec"
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

/* =============================== 初始化 ================================ */
window.onload = function(){
    loadFood();
    loadFavorites();
    loadTypeOptions();
};

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
        const isFav = favoriteNames.has(item.name);
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
        const matchesKeyword = (
            (item.name && item.name.toLowerCase().includes(keyword)) ||
            (item.type && item.type.toLowerCase().includes(keyword)) ||
            (item.address && item.address.toLowerCase().includes(keyword))
        );
        const matchesFavorite = !showFavoritesOnly || favoriteNames.has(item.name);
        const itemRegion = detectRegion(item.address);
        const matchesRegion = selectedRegions.size === 0 || (itemRegion && selectedRegions.has(itemRegion));
        return matchesKeyword && matchesFavorite && matchesRegion;
    });
    renderList(result);
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
            favoriteNames.delete(name); // 後端已同步移除收藏，前端本地狀態也一併同步
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