/* ============================================================
   tag-swing.js — 店家卡片「類型／地區」標籤的點擊互動
   ------------------------------------------------------------
   標籤平常是靜止的：CSS 的 .food-type / .region-tag 預設就停在各自
   隨機的「重力垂墜角」（--tag-rest-tilt，見 food-crud.js 產生元素時
   的行內樣式）；卡片捲動進畫面時，CSS 的 @keyframes tagEntranceShake
   會讓標籤上下用力抖個兩三下再穩穩停住（見 style.css）。

   這支檔案只負責「使用者點擊標籤時」再疊加一段短促、幅度較小的
   「微微抖動」：用 sin 波乘上快速衰減的指數，抖幾下就收斂回垂墜角，
   而不是回到 0 度。點擊當下先暫停 CSS 動畫（無論是還停在最後一格的
   進場動畫，或萬一使用者手速夠快、進場抖動還沒播完），避免兩邊
   同時搶著改 transform；抖完清掉行內樣式、拿掉暫停 class，
   控制權交還給 CSS。

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
     * 對單一標籤元素播放一次「點擊後微微抖動」動畫。
     * 疊加在該標籤自己的重力垂墜角（--tag-rest-tilt / data-rest-tilt）
     * 之上，幅度比進場抖動小很多，強調「點一下、輕輕晃一晃」的手感。
     */
    function nudgeTag(el) {
        if (!el || el.dataset.swinging === "1") return; // 動畫進行中就不重複觸發

        el.dataset.swinging = "1";
        el.classList.add("tag-nudged"); // 暫停 CSS 動畫，改由這裡接手 transform

        var restTilt = parseFloat(el.dataset.restTilt);
        if (isNaN(restTilt)) restTilt = 5; // 保底值，理論上 food-crud.js 建立時一定會給

        var duration = 380; // 很短，強調「微微抖一下」而不是明顯的大晃動
        var amplitude = 5; // 疊加在垂墜角上的抖動幅度（度），比進場動畫小很多
        var cycles = 4; // 短時間內多來回幾次，才有顆粒分明的顫抖感
        var start = null;

        function frame(now) {
            if (start === null) start = now;
            var t = (now - start) / duration;

            if (t >= 1) {
                // 動畫結束：清掉行內 transform，交還控制權給 CSS
                el.style.transform = "";
                el.classList.remove("tag-nudged");
                el.dataset.swinging = "0";
                return;
            }

            var decay = Math.exp(-t * 7); // 衰減得比進場動畫快，抖幾下就收斂
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

        // click 對滑鼠點擊、觸控點按都適用（標籤已加上 touch-action:manipulation，
        // 手機點擊不會有 300ms 判斷雙擊縮放的延遲），不需要另外處理 touchstart
        container.addEventListener("click", handleClick);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
