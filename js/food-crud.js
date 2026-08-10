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
// 載入超過 3 秒還沒完成時，輪流顯示的小提示（跟一般的「正在載入」訊息分開，
// 避免載入很快的正常情況下，畫面還要多閃過一次沒必要的切換）
const LONG_LOADING_TIPS = [
    "美食名單正在努力奔跑中",
    "廚房還在整理今天的菜色",
    "正在把回憶中的美味一道一道端出來",
    "網路也肚子餓了，讓它喘口氣",
    "快好了，先深呼吸配一口口水",
    "小口袋正在努力塞滿美食清單",
    "老闆說再等一下下就好",
    "正在幫每一道菜排隊入座",
    "美食雷達正在全力搜索中",
    "資料們正在排隊搭電梯下樓",
    "正在把最新鮮的口袋名單端上桌",
    "再撐一下，好料值得等待"
];

function loadFood(){
    const container = document.getElementById("foodContainer");
    // 只有「真正的第一次載入」（頁面剛開啟、或上次從未成功載入過）才把清單
    // 整個換成置中的載入畫面。新增/編輯/刪除後呼叫的 loadFood() 屬於「重新整理」，
    // 這時候故意不清空容器：讓舊卡片留著，等新資料回來後再一次換上新卡片。
    // 這樣可避免「列表→縮成一小塊載入中文字→再變回列表」這種容器高度忽縮忽脹的
    // 過程，那正是捲動位置沒變、但畫面內容跳來跳去（看起來像整個背景往下滑）的主因。
    const isFirstLoad = !foodListLoaded;
    if(isFirstLoad){
        container.innerHTML = `
            <div class="loading">
                正在載入美食收藏...
            </div>
        `;
    }

    let settled = false;
    let tipIndex = 0;
    let tipInterval = null;

    // 超過 3 秒還在載入，才切換成比較可愛、帶輪播提示的訊息（僅第一次載入時才會切換畫面，
    // 重新整理時容器內容維持原本卡片不變，這個提示就不需要出現）
    const longLoadTimer = setTimeout(function(){
        if(settled || !isFirstLoad) return;
        container.innerHTML = `
            <div class="loading loading--long">
                <div class="loading-emoji">🍜</div>
                <div class="loading-title">美食名單正在努力載入中…</div>
                <div class="loading-tip loading-tip--fade" id="loadingTip">${escapeHtml(LONG_LOADING_TIPS[0])}</div>
            </div>
        `;
        tipInterval = setInterval(function(){
            tipIndex = (tipIndex + 1) % LONG_LOADING_TIPS.length;
            const tipEl = document.getElementById("loadingTip");
            if(!tipEl) return;
            tipEl.textContent = LONG_LOADING_TIPS[tipIndex];
            // 移除再加回 class，強制重新觸發淡入動畫，讓每一句提示切換時都有一點過渡感
            tipEl.classList.remove("loading-tip--fade");
            void tipEl.offsetWidth; // 強制觸發 reflow
            tipEl.classList.add("loading-tip--fade");
        }, 3100);
    }, 3000);

    function stopLongLoadingUI(){
        settled = true;
        clearTimeout(longLoadTimer);
        if(tipInterval) clearInterval(tipInterval);
    }

    // 我的最愛失敗不該拖累整個店家清單的顯示，這裡自己接住錯誤、當作「目前沒有收藏」處理，
    // 這樣下面的 Promise.all 才不會因為這個次要資料失敗，就連主要的店家清單都一起顯示錯誤畫面
    const favoritesPromise = apiGet("getFavorites")
        .catch(function(error){
            console.error("讀取我的最愛失敗：", error);
            return [];
        });

    Promise.all([ apiGet("getFoodList"), favoritesPromise ])
        .then(function(results){
            stopLongLoadingUI();
            allFoodData = results[0] || [];
            favoriteNames = new Set(results[1] || []);
            foodListLoaded = true;
            updateCount();
            renderRegionFilters();
            renderTypeFilters();
            filterFood();
            prefetchGeocodesInBackground();
        })
        .catch(function(error){
            stopLongLoadingUI();
            if(isFirstLoad){
                container.innerHTML = `
                    <div class="empty">
                        ⚠️
                        <h3>載入失敗</h3>
                        <p>${escapeHtml((error && error.message) ? error.message : "請確認 CONFIG.API_URL 是否已正確設定")}</p>
                        <button type="button" class="primary-btn" style="margin-top:14px;max-width:200px;" onclick="loadFood()"><i class="bi bi-arrow-clockwise"></i> 重試</button>
                    </div>
                `;
            } else {
                // 重新整理（新增/編輯/刪除後）失敗：畫面上原本的卡片先保留著，
                // 只用 toast 提示，不要把整個列表換成錯誤畫面
                showToast("清單更新失敗，請稍後重新整理頁面");
            }
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
    // 每次重新渲染（篩選、搜尋、重新整理清單）前，先取消監看舊卡片，
    // 避免舊的、已被移出畫面的節點一直留在觀察者名單裡
    if(cardObserver){
        Array.from(container.children).forEach(el => cardObserver.unobserve(el));
    }
    container.innerHTML="";
    
    if(data.length===0){
        container.innerHTML= `
            <div class="empty">
                🍽️
                <h3> 還沒有收藏餐廳 </h3>
                <p> 開始建立你的美食地圖吧！ </p>
            </div>
        `;
        if(typeof window.refreshStickyForm === "function"){
            requestAnimationFrame(window.refreshStickyForm);
        }
        return;
    }
    
    data.forEach((item)=>{
        const card = document.createElement("div");
        card.className = "food-card";
        
        /* 收藏星星 */
        const isFav = favoriteNames.has(String(item.name));
        const favBtn = document.createElement("button");
        favBtn.className = "favorite-btn" + (isFav ? " active" : "");
        favBtn.innerHTML = isFav ? '<i class="bi bi-star-fill"></i>' : '<i class="bi bi-star"></i>';
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
            type.innerHTML = '<i class="bi bi-tag-fill"></i> ' + escapeHtml(item.type);
        }

        /* 地區標籤（依地址判斷，不同地區給不同顏色） */
        let regionTag;
        const regionName = detectRegion(item.address);
        if(regionName){
            const colors = getRegionColor(regionName);
            regionTag = document.createElement("div");
            regionTag.className = "region-tag";
            regionTag.style.setProperty("--tag-color", colors.color);
            regionTag.innerHTML = '<i class="bi bi-geo-alt-fill"></i> ' + escapeHtml(regionName);
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
            let starsHtml = "";
            for(let s = 0; s < 5; s++){
                starsHtml += s < score ? '<i class="bi bi-star-fill"></i>' : '<i class="bi bi-star"></i>';
            }
            rating.innerHTML = starsHtml;
        }
        
        /* 地址（點擊前往 Google Maps） */
        let address;
        if(item.address){
            address = document.createElement("div");
            address.className = "address";
            address.innerHTML = '<i class="bi bi-geo-alt-fill"></i> ' + escapeHtml(item.address);
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
            linkAnchor.innerHTML = '<i class="bi bi-link-45deg"></i> 查看相關網頁';
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
            updatedTime.innerHTML = '<i class="bi bi-clock-fill"></i> 最後更新：' + formatDateTime(item.updatedAt);
        }

        /* 編輯 */
        const edit = document.createElement("button");
        edit.className = "edit-btn";
        edit.innerHTML = '<i class="bi bi-pencil-fill"></i>';
        edit.setAttribute("aria-label", "編輯此餐廳");
        edit.onclick = ()=>editFoodItem(item);

        /* 刪除 */
        const del = document.createElement("button");
        del.className = "delete-btn";
        del.innerHTML = '<i class="bi bi-trash-fill"></i>';
        del.onclick = ()=>deleteFoodItem( item.rowNum, item.name );

        /* 分享（右下角） */
        const shareWrap = document.createElement("div");
        shareWrap.className = "share-wrap";
        const shareBtn = document.createElement("button");
        shareBtn.className = "share-btn";
        shareBtn.innerHTML = '<i class="bi bi-reply-fill"></i>';
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
        observeCardEntrance(card);
    });

    // 列表內容變動（筆數增減）可能會讓桌機版黏性卡片「正常排版」的位置跟著改變，
    // 等這一輪版面真正 reflow 完成後，請 sticky-form.js 重新量測一次，避免卡片
    // 用到過期的位置計算出錯誤的位移量而跳動。
    if(typeof window.refreshStickyForm === "function"){
        requestAnimationFrame(window.refreshStickyForm);
    }
}

/* =============================== 卡片進場動畫（滾到才播放） ================================ */
// 共用同一個 IntersectionObserver：卡片第一次捲動進入畫面時才觸發「貼上」動畫，
// 一旦播放過就取消監看，離開畫面再捲回來不會重播；畫面一開始就在可視範圍內的卡片也一樣要捲到才播（threshold 判斷）
let cardObserver = null;
function getCardObserver(){
    if(cardObserver) return cardObserver;
    cardObserver = new IntersectionObserver(function(entries){
        // 同一次捲動一起進入畫面的卡片（例如桌機版一列有好幾張），依序給一點延遲，做出接力貼上的節奏
        entries
            .filter(entry => entry.isIntersecting)
            .forEach(function(entry, i){
                const el = entry.target;
                el.style.animationDelay = (i * 90) + "ms";
                el.classList.add("card-in-view");
                cardObserver.unobserve(el);
            });
    }, { threshold: 0.2, rootMargin: "0px 0px -60px 0px" });
    return cardObserver;
}
function observeCardEntrance(card){
    if(typeof IntersectionObserver === "undefined"){
        // 極少數不支援的瀏覽器：直接顯示，不套用捲動觸發動畫
        card.style.opacity = "1";
        return;
    }
    getCardObserver().observe(card);
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
    const trimmedName = data.name.trim();
    apiPost("saveFood", data, {
        retryCount: 1,
        onSlow: function(){ showToast("還在努力送出中，請稍候… 🐢"); }
    })
        .then(function(response){
            showToast( "🎉 " + (response.message || "儲存成功！") );
            document.getElementById("foodForm")?.reset();
            closeModal();
            loadFood();
        })
        .catch(function(error){
            // 如果是「我們自己發動的重試」才出現的「已經收藏過」錯誤，
            // 代表第一次請求其實已經送出成功，只是回應逾時；不是真的失敗，直接當成功處理
            if(error && error.wasRetry && error.message && error.message.indexOf(`已經收藏過「${trimmedName}」`) !== -1){
                showToast( "🎉 看起來已經新增成功了！" );
                document.getElementById("foodForm")?.reset();
                closeModal();
                loadFood();
                return;
            }
            showToast(error && error.message ? error.message : "儲存失敗，請再試一次");
            console.error(error);
        });
}

/* =============================== 更新既有資料 ================================ */
function updateFoodData(rowNum, data){
    if(!data.name.trim()){
        showToast( "請輸入餐廳名稱" );
        return;
    }
    // 如果這次編輯把地址改掉了，代表原本存在裝置上的定位快取已經不準了：
    // 把舊地址的快取清掉，下次打開地圖時就會針對「這一家」重新定位、重新存檔，
    // 地址沒改的話快取還是有效，不用重查
    const existingItem = allFoodData.find(function(item){ return item.rowNum === rowNum; });
    const newAddress = data.address ? data.address.trim() : "";
    if(existingItem && existingItem.address && existingItem.address !== newAddress && typeof invalidateGeocodeCache === "function"){
        invalidateGeocodeCache(existingItem.address);
    }
    showToast( "正在更新..." );
    apiPost("updateFood", Object.assign({ rowNum: rowNum }, data), {
        retryCount: 1,
        onSlow: function(){ showToast("還在努力更新中，請稍候… 🐢"); }
    })
        .then(function(response){
            showToast( "✏️ " + (response.message || "更新成功！") );
            document.getElementById("foodForm")?.reset();
            closeModal();
            loadFood();
        })
        .catch(function(error){
            showToast(error && error.message ? error.message : "更新失敗，請再試一次");
            console.error(error);
        });
}

/* =============================== 進入 / 離開編輯模式 ================================ */
// 把選項填入 select；若該選項已不在清單裡（例如類型設定被移除），就退回提示狀態
function setSelectValue(selectId, value){
    const select = document.getElementById(selectId);
    if(!select) return;
    select.value = value || "";
    // 用字串比較：試算表讀回來的評價常是數字型態（例如 3），
    // 但 select.value 一律回傳字串（"3"），直接用 !== 比較型別不同一定不相等，會誤判成「不在選項內」
    if(String(select.value) !== String(value || "")){
        select.value = "";
    }
}

// 點擊卡片上的「✏️編輯」時，把該筆資料填回表單，並切換成編輯模式
function editFoodItem(item){
    editingRowNum = item.rowNum;

    // 桌機表單
    document.getElementById("name").value = item.name || "";
    setSelectValue("type", item.type);
    setSelectValue("rating", item.rating);
    document.getElementById("address").value = item.address || "";
    document.getElementById("link").value = item.link || "";
    document.getElementById("note").value = item.note || "";

    // 手機表單
    document.getElementById("m-name").value = item.name || "";
    setSelectValue("m-type", item.type);
    setSelectValue("m-rating", item.rating);
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
    apiPost("deleteFood", { rowNum: rowNum }, {
        retryCount: 1,
        onSlow: function(){ showToast("還在努力刪除中，請稍候… 🐢"); }
    })
        .then(function(response){
            favoriteNames.delete(String(name)); // 後端已同步移除收藏，前端本地狀態也一併同步
            showToast( "🗑️ 已刪除" );
            loadFood();
        })
        .catch(function(error){
            // 如果是「我們自己發動的重試」才出現的「找不到該筆資料」，
            // 代表第一次請求其實已經刪除成功，只是回應逾時；不是真的失敗，直接當成功處理
            if(error && error.wasRetry && error.message && error.message.indexOf("找不到該筆資料") !== -1){
                favoriteNames.delete(String(name));
                showToast( "🗑️ 已刪除" );
                loadFood();
                return;
            }
            showToast(error && error.message ? error.message : "刪除失敗，請再試一次");
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

