/* =============================================================
   favorites.js — 我的最愛功能
   內容：loadFavorites()、toggleFavFilter()、toggleFavoriteItem()
============================================================= */

/* =============================== 讀取我的最愛清單 ================================ */
function loadFavorites(){
    apiGet("getFavorites")
        .then(function(names){
            favoriteNames = new Set(names || []);
            // 店家清單如果還沒真正載入完成，這裡先不要渲染：
            // allFoodData 這時候可能還是初始的空陣列，搶先渲染會讓畫面短暫誤顯示「還沒有收藏餐廳」，
            // 等 loadFood() 自己完成時，畫面本來就會用這裡剛設好的 favoriteNames 正確渲染一次
            if(foodListLoaded){
                filterFood(); // 依目前的搜尋字串/篩選狀態重新渲染，套用最愛標記
            }
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
            btnEl.textContent = wasFavorite ? "★" : "☆";
            btnEl.disabled = false;
            showToast(error && error.message ? error.message : "更新最愛失敗，請再試一次");
            console.error(error);
        });

    // 若目前正在「只看最愛」篩選模式下取消收藏，要把卡片從畫面移除
    if(showFavoritesOnly){
        filterFood();
    }
}
