/*
 * corner-glow.js
 * ------------------------------------------------------------
 * 專門負責「店家卡片右上角／左下角動態漸層 border」的插入與維護。
 * 顏色與動畫效果完全交給 style.css 的 .corner-glow 規則處理
 * （會自動吃 --primary / --accent-gold / --secondary 這幾個主題變數，
 *   所以切換風格色調時光框顏色會自動跟著換，這支 js 不用管顏色）。
 *
 * 這支檔案只做一件事：確保每一張 .food-card 底下都有
 *   <span class="corner-glow corner-glow--tr">（右上角）
 *   <span class="corner-glow corner-glow--bl">（左下角）
 * 因為 #foodContainer 裡的卡片是 food-crud.js 用 innerHTML="" 清空、
 * 再逐一 createElement 動態產生（搜尋、篩選、排序、新增/刪除都會整批重繪），
 * 所以用 MutationObserver 監看容器變化，卡片一出現就自動補上光框，
 * 不需要去修改既有的 food-crud.js。
 */
(function () {
    "use strict";

    var CONTAINER_ID = "foodContainer";
    var CARD_SELECTOR = ".food-card";
    var GLOW_CLASS = "corner-glow";

    function addGlowTo(card) {
        // 避免重複插入（例如同一張卡片被 observer 掃到兩次）
        if (card.querySelector("." + GLOW_CLASS)) return;

        var topRight = document.createElement("span");
        topRight.className = GLOW_CLASS + " " + GLOW_CLASS + "--tr";
        topRight.setAttribute("aria-hidden", "true");

        var bottomLeft = document.createElement("span");
        bottomLeft.className = GLOW_CLASS + " " + GLOW_CLASS + "--bl";
        bottomLeft.setAttribute("aria-hidden", "true");

        // 插在最前面（prepend），讓 favorite / edit / delete 按鈕等實際內容
        // 疊在光框「之上」，不會被光框蓋住或擋到點擊。
        card.prepend(bottomLeft);
        card.prepend(topRight);
    }

    function scanForCards(root) {
        if (!root || typeof root.querySelectorAll !== "function") return;

        if (root.matches && root.matches(CARD_SELECTOR)) {
            addGlowTo(root);
        }
        var cards = root.querySelectorAll(CARD_SELECTOR);
        for (var i = 0; i < cards.length; i++) {
            addGlowTo(cards[i]);
        }
    }

    function init() {
        var container = document.getElementById(CONTAINER_ID);
        if (!container) return;

        // 頁面載入當下若已經有卡片（例如快取過的資料），先掃一次
        scanForCards(container);

        var observer = new MutationObserver(function (mutations) {
            for (var m = 0; m < mutations.length; m++) {
                var added = mutations[m].addedNodes;
                for (var n = 0; n < added.length; n++) {
                    var node = added[n];
                    if (node.nodeType !== 1) continue; // 只處理 element node
                    scanForCards(node);
                }
            }
        });

        observer.observe(container, { childList: true, subtree: true });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
