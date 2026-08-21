/* ============================================================
   tag-swing.js — 店家卡片「類型／地區」標籤的懸吊搖擺互動
   ------------------------------------------------------------
   待機時的輕微擺動已經用 CSS 的 @keyframes tagSway 處理（見 style.css），
   標籤會繞著左側偏內一點的支點、以各自的「重力垂墜角」(--tag-rest-tilt)
   為中心左右微晃，模擬被線/釘子固定在左邊、重心偏右下垂的懸掛感。

   這支檔案只負責「使用者點擊標籤時」的加強互動：疊加一段短促、
   高頻率、快速收斂的小幅顫抖（像被手指戳了一下），抖完之後清掉
   行內 transform，讓 CSS 的待機擺動動畫接手——因為過程中只是把
   animation-play-state 暫停而非重置，接手時會直接從暫停前的那個
   時間點繼續播放，速度感是連續的，不會有重新啟動的頓挫感。

   用事件委派掛在 #foodContainer 上，這樣就算卡片是動態產生/
   重新渲染的，也不需要每次重繪後重新綁定事件。
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
     * 對單一標籤元素播放一次「點擊後顫抖」動畫。
     * 顫抖是疊加在該標籤自己的重力垂墜角（--tag-rest-tilt / data-rest-tilt）
     * 之上，用 sin 波乘上快速衰減的指數模擬短促的抖動感，
     * 抖幾下就收斂回垂墜角，而不是回到 0 度。
     */
    function nudgeTag(el) {
        if (!el || el.dataset.swinging === "1") return; // 動畫進行中就不重複觸發

        el.dataset.swinging = "1";
        el.classList.add("tag-nudged"); // 暫停 CSS 待機微擺，改由這裡接手 transform

        var restTilt = parseFloat(el.dataset.restTilt);
        if (isNaN(restTilt)) restTilt = 5; // 保底值，理論上 food-crud.js 建立時一定會給

        var duration = 480; // 顫抖時間短，強調「抖一下」而非大幅度晃動
        var amplitude = 9; // 疊加在垂墜角上的最大抖動幅度（度）
        var cycles = 5; // 短時間內多來回幾次，才有顆粒分明的顫抖感
        var start = null;

        function frame(now) {
            if (start === null) start = now;
            var t = (now - start) / duration;

            if (t >= 1) {
                // 動畫結束：清掉行內 transform，交還控制權給 CSS 的 tagSway
                // （此時 tagSway 會從暫停前的時間點接續播放，速度不變）
                el.style.transform = "";
                el.classList.remove("tag-nudged");
                el.dataset.swinging = "0";
                return;
            }

            var decay = Math.exp(-t * 6.5); // 衰減比待機擺動快得多，抖幾下就收斂
            var offset = amplitude * decay * Math.sin(t * cycles * Math.PI * 2);
            el.style.transform = "rotate(" + (restTilt + offset).toFixed(2) + "deg)";
            requestAnimationFrame(frame);
        }

        requestAnimationFrame(frame);
    }

    function handleClick(e) {
        var tag = e.target.closest ? e.target.closest(TAG_SELECTOR) : null;
        if (tag) nudgeTag(tag);
    }

    function init() {
        var container = document.getElementById("foodContainer");
        if (!container) return;

        // click 對滑鼠點擊、觸控點按都適用，不需要另外處理 touchstart
        container.addEventListener("click", handleClick);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
