/* =============================================================
   food-crud.js — 美食清單資料流
   內容：讀取類型選項、載入清單、渲染卡片、
         新增／編輯／刪除、Modal 控制
============================================================= */

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
            renderTypeFilters();
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

        /* 分享（右下角） */
        const shareWrap = document.createElement("div");
        shareWrap.className = "share-wrap";
        const shareBtn = document.createElement("button");
        shareBtn.className = "share-btn";
        shareBtn.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
        shareBtn.setAttribute("aria-label", "分享此餐廳");
        shareBtn.onclick = function(e){
            e.stopPropagation();
            handleShareClick(item, shareBtn);
        };
        shareWrap.appendChild(shareBtn);
        
        card.appendChild(edit);
        card.appendChild(del);
        card.appendChild(headerRow);
        if(tagRow) card.appendChild(tagRow);
        if(rating) card.appendChild(rating);
        if(address) card.appendChild(address);
        if(linkAnchor) card.appendChild(linkAnchor);
        if(note) card.appendChild(note);
        if(updatedTime) card.appendChild(updatedTime);
        card.appendChild(shareWrap);

        container.appendChild(card);
    });
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

