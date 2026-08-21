/* ============================================================
   tag-swing.js — 店家卡片「類型／地區」標籤的懸吊搖擺互動
   ------------------------------------------------------------
   待機時的輕微擺動已經用 CSS 的 @keyframes tagSway 處理（見 style.css），
   這支檔案只負責「使用者滑過或點按標籤時」的加強互動：
   做一個振幅較大、隨時間衰減的阻尼震盪（像用手指撥了一下吊牌），
   結束後清掉行內 transform，讓 CSS 的待機動畫自然接手。

   用事件委派（capture 階段）掛在 #foodContainer 上，這樣就算卡片是
   動態產生/重新渲染的，也不需要每次重繪後重新綁定事件。
   ============================================================ */
(function () {
    "use strict";

    // 使用者系統設定「減少動態效果」時，完全不做這個互動動畫
    var prefersReducedMotion =
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    var TAG_SELECTOR = ".food-type, .region-tag";

    /**
     * 對單一標籤元素播放一次「撥動後阻尼晃動」動畫。
     * 用 sin 波乘上指數衰減模擬彈簧慢慢停下來的感覺，
     * 而不是單純的擺回原位，晃起來才有「真的被撥了一下」的手感。
     */
    function nudgeTag(el) {
        if (!el || el.dataset.swinging === "1") return; // 動畫進行中就不重複觸發

        el.dataset.swinging = "1";
        el.classList.add("tag-nudged"); // 暫停 CSS 待機微擺，改由這裡接手 transform

        var duration = 900; // 整段撥動動畫時間（ms）
        var amplitude = 16; // 剛撥動當下的最大擺幅（度）
        var cycles = 3; // 停下來之前大約晃幾個來回
        var start = null;

        function frame(now) {
            if (start === null) start = now;
            var t = (now - start) / duration;

            if (t >= 1) {
                // 動畫結束：清掉行內 transform，交還控制權給 CSS 的 tagSway
                el.style.transform = "";
                el.classList.remove("tag-nudged");
                el.dataset.swinging = "0";
                return;
            }

            var decay = Math.exp(-t * 4.5); // 指數衰減，晃動幅度隨時間變小
            var angle = amplitude * decay * Math.sin(t * cycles * Math.PI * 2);
            el.style.transform = "rotate(" + angle.toFixed(2) + "deg)";
            requestAnimationFrame(frame);
        }

        requestAnimationFrame(frame);
    }

    function handlePointerEnter(e) {
        var tag = e.target.closest ? e.target.closest(TAG_SELECTOR) : null;
        if (tag) nudgeTag(tag);
    }

    function handleTouchStart(e) {
        var touch = e.touches && e.touches[0];
        if (!touch) return;
        var el = document.elementFromPoint(touch.clientX, touch.clientY);
        var tag = el && el.closest ? el.closest(TAG_SELECTOR) : null;
        if (tag) nudgeTag(tag);
    }

    function init() {
        var container = document.getElementById("foodContainer");
        if (!container) return;

        // mouseenter 不會冒泡，但在 capture 階段掛在祖先節點上，
        // 一樣能攔截到子孫元素（包含動態新增的卡片）觸發的事件，達到事件委派的效果
        container.addEventListener("mouseenter", handlePointerEnter, true);
        // 手機沒有 hover，改用 touchstart 判斷觸點底下是不是標籤
        container.addEventListener("touchstart", handleTouchStart, {
            passive: true,
            capture: true,
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
