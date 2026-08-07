/* =============================================================
   favorites.js — 我的最愛功能
   內容：toggleFavFilter()、toggleFavoriteItem()
   說明：讀取「我的最愛」清單的邏輯已經併入 food-crud.js 的 loadFood()，
         跟店家清單一起用 Promise.all 等待、一起渲染，避免兩邊各自載入、
         各自渲染造成的時間差（店家清單先跑出來、最愛卻慢半拍才更新，容易讓使用者誤會）
============================================================= */

/* =============================== 切換「只看最愛」篩選 ================================ */
function toggleFavFilter(){
    showFavoritesOnly = !showFavoritesOnly;
    document.getElementById("favFilterBtn").classList.toggle("active", showFavoritesOnly);
    if(typeof syncMobileFavoriteButton === "function") syncMobileFavoriteButton();
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
    // 星星圖示改用 Bootstrap Icons（見 food-crud.js 渲染卡片時的寫法），
    // 這裡切換收藏狀態時也要用同一組 <i class="bi ..."> 圖示，
    // 不能再寫回純文字的 ★／☆，不然點下去圖示就會被蓋掉、打回原本醜醜的字元星星
    btnEl.innerHTML = !wasFavorite ? '<i class="bi bi-star-fill"></i>' : '<i class="bi bi-star"></i>';

    apiPost("toggleFavorite", { name: name }, {
        // 這裡刻意不傳 retryCount：切換最愛是「切」的動作，不是單純寫入固定值，
        // 自動重試等於又切一次，會變回原狀，比手動再按一次還危險，所以只給處理中提示、不重試
        onSlow: function(){ showToast("還在努力送出中，請稍候… 🐢"); }
    })
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
            btnEl.innerHTML = wasFavorite ? '<i class="bi bi-star-fill"></i>' : '<i class="bi bi-star"></i>';
            btnEl.disabled = false;
            showToast(error && error.message ? error.message : "更新最愛失敗，請再試一次");
            console.error(error);
        });

    // 若目前正在「只看最愛」篩選模式下取消收藏，要把卡片從畫面移除
    if(showFavoritesOnly){
        filterFood();
    }
}
