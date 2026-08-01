/* ======================================================================
   introAnimation.js
   全螢幕開場過場動畫（獨立檔案，不與 apiFunction.js 合併）

   使用方式：
   將這支腳本「原封不動地」放在 <body> 開始標籤之後、
   其餘畫面內容（.food-bg 等）之前，並且「不要」加上 defer 或 async，
   這樣它會在瀏覽器開始畫出頁面內容之前就先執行、蓋住整個畫面，
   避免使用者看到內容先閃一下才被蓋住的情況。

   例如：
   <body>
       <script src="introAnimation.js"></script>
       <div class="food-bg" ...> ... </div>
       ...

   行為說明：
   - 動畫播放期間，畫面完全無法滾動（電腦滾輪 / 手機觸控滑動 / 鍵盤方向鍵、
     空白鍵、PageUp/PageDown、Home/End 都會被攔截）。
   - 動畫播放期間會建立一個全螢幕、最高層級的遮罩，蓋住所有可互動元素，
     使用者無法點擊到下方任何按鈕或輸入框。
   - 會等待「頁面所有資源載入完成（window.load）」以及「最短播放時間」
     兩者都滿足後，才淡出動畫、恢復可滾動 / 可互動狀態。
   - 加上安全逾時機制，避免因某項資源一直載入不完而讓動畫永遠卡住。
   ====================================================================== */

(function () {
    "use strict";

    // ---------- 可調整參數 ----------
    var MIN_DISPLAY_MS = 1400;   // 動畫至少播放的時間（毫秒）
    var MAX_WAIT_MS = 6000;      // 最長等待頁面載入的時間，超過就強制結束（保險機制）
    var FADE_OUT_MS = 500;       // 淡出動畫時間（要跟下方 CSS transition 秒數一致）

    // ---------- 避免在不支援的環境（例如沒有 document.body）中出錯 ----------
    if (!document || !document.documentElement) return;

    var startTime = Date.now();
    var removed = false;

    /* ---------------------------------------------------------------
       1. 注入樣式
       使用 style.css 已經定義好的 CSS 變數（--primary、--bg-grad-* 等），
       這樣過場動畫的顏色會自動跟隨使用者上次選擇的風格色調。
    --------------------------------------------------------------- */
    var styleTag = document.createElement("style");
    styleTag.id = "introAnimationStyle";
    styleTag.textContent = [
        "html.intro-lock, html.intro-lock body {",
        "    overflow: hidden !important;",
        "    height: 100% !important;",
        "    overscroll-behavior: none !important;",
        "}",
        "#introOverlay {",
        "    position: fixed;",
        "    inset: 0;",
        "    z-index: 999999;",
        "    display: flex;",
        "    flex-direction: column;",
        "    align-items: center;",
        "    justify-content: center;",
        "    gap: 18px;",
        "    background: linear-gradient(160deg, var(--bg-grad-1, #fdf3e2), var(--bg-grad-2, #f8e4c4) 55%, var(--bg-grad-3, #f3d6b4));",
        "    touch-action: none;",
        "    -webkit-touch-callout: none;",
        "    -webkit-user-select: none;",
        "    user-select: none;",
        "    transition: opacity " + FADE_OUT_MS + "ms ease, visibility " + FADE_OUT_MS + "ms ease;",
        "    opacity: 1;",
        "    visibility: visible;",
        "}",
        "#introOverlay.intro-fade-out {",
        "    opacity: 0;",
        "    visibility: hidden;",
        "}",
        "#introOverlay .intro-logo {",
        "    width: 96px;",
        "    height: 96px;",
        "    object-fit: contain;",
        "    animation: introBounce 1.1s ease-in-out infinite;",
        "    filter: drop-shadow(0 10px 18px rgba(var(--shadow-rgb, 180,101,48), .35));",
        "}",
        "#introOverlay .intro-title {",
        "    font-family: 'Noto Sans TC', sans-serif;",
        "    font-weight: 900;",
        "    font-size: 26px;",
        "    color: var(--text, #2b2118);",
        "    letter-spacing: 1px;",
        "}",
        "#introOverlay .intro-sub {",
        "    font-family: 'Noto Sans TC', sans-serif;",
        "    font-weight: 500;",
        "    font-size: 14px;",
        "    color: var(--muted, #8a7862);",
        "    display: flex;",
        "    align-items: center;",
        "    gap: 4px;",
        "}",
        "#introOverlay .intro-dot {",
        "    width: 6px;",
        "    height: 6px;",
        "    border-radius: 50%;",
        "    background: var(--primary, #e2492a);",
        "    animation: introDotPulse 1.2s ease-in-out infinite;",
        "}",
        "#introOverlay .intro-dot:nth-child(2) { animation-delay: .15s; }",
        "#introOverlay .intro-dot:nth-child(3) { animation-delay: .3s; }",
        "#introOverlay .intro-bar-track {",
        "    width: 180px;",
        "    height: 5px;",
        "    border-radius: 999px;",
        "    background: rgba(var(--shadow-rgb, 180,101,48), .18);",
        "    overflow: hidden;",
        "}",
        "#introOverlay .intro-bar-fill {",
        "    width: 40%;",
        "    height: 100%;",
        "    border-radius: 999px;",
        "    background: linear-gradient(90deg, var(--primary, #e2492a), var(--accent-gold, #d8a23b));",
        "    animation: introBarSlide 1.1s ease-in-out infinite;",
        "}",
        "@keyframes introBounce {",
        "    0%, 100% { transform: translateY(0) rotate(-4deg); }",
        "    50% { transform: translateY(-14px) rotate(4deg); }",
        "}",
        "@keyframes introDotPulse {",
        "    0%, 100% { opacity: .25; transform: scale(.85); }",
        "    50% { opacity: 1; transform: scale(1.15); }",
        "}",
        "@keyframes introBarSlide {",
        "    0% { transform: translateX(-100%); }",
        "    100% { transform: translateX(250%); }",
        "}"
    ].join("\n");
    document.head.appendChild(styleTag);

    /* ---------------------------------------------------------------
       2. 立刻鎖住捲動
    --------------------------------------------------------------- */
    document.documentElement.classList.add("intro-lock");

    function preventDefault(e) {
        e.preventDefault();
    }

    function preventScrollKeys(e) {
        // 空白鍵、方向鍵、PageUp/Down、Home/End 都會造成頁面捲動，一併攔截
        var scrollKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "];
        if (scrollKeys.indexOf(e.key) !== -1) {
            e.preventDefault();
        }
    }

    // wheel / touchmove 需要 { passive: false } 才能真正阻止捲動
    window.addEventListener("wheel", preventDefault, { passive: false });
    window.addEventListener("touchmove", preventDefault, { passive: false });
    window.addEventListener("keydown", preventScrollKeys, false);

    /* ---------------------------------------------------------------
       3. 建立遮罩並插入畫面
       在 <body> 一開始就插入，避免使用者看到底下內容先短暫閃過。
    --------------------------------------------------------------- */
    function buildOverlay() {
        var overlay = document.createElement("div");
        overlay.id = "introOverlay";

        var emoji = document.createElement("img");
        emoji.className = "intro-logo";
        emoji.setAttribute("aria-hidden", "true");
        emoji.setAttribute("alt", "");
        emoji.src = "logo.png";

        var title = document.createElement("div");
        title.className = "intro-title";
        title.textContent = "美食口袋名單";

        var sub = document.createElement("div");
        sub.className = "intro-sub";
        sub.innerHTML = "正在準備美味內容" +
            '<span class="intro-dot"></span>' +
            '<span class="intro-dot"></span>' +
            '<span class="intro-dot"></span>';

        var barTrack = document.createElement("div");
        barTrack.className = "intro-bar-track";
        var barFill = document.createElement("div");
        barFill.className = "intro-bar-fill";
        barTrack.appendChild(barFill);

        overlay.appendChild(emoji);
        overlay.appendChild(title);
        overlay.appendChild(sub);
        overlay.appendChild(barTrack);

        // 擋掉任何點擊 / 觸控事件穿透到下方內容
        overlay.addEventListener("click", preventDefault, false);
        overlay.addEventListener("touchstart", preventDefault, { passive: false });

        if (document.body) {
            document.body.appendChild(overlay);
        } else {
            // 極少數情況下 body 尚未存在，等 DOM 建立到 body 後再插入
            document.addEventListener("DOMContentLoaded", function () {
                document.body.appendChild(overlay);
            });
        }
        return overlay;
    }

    var overlayEl = buildOverlay();

    /* ---------------------------------------------------------------
       4. 結束動畫：淡出、解除捲動鎖定、移除節點
    --------------------------------------------------------------- */
    function finishIntro() {
        if (removed) return;
        removed = true;

        var elapsed = Date.now() - startTime;
        var remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);

        setTimeout(function () {
            overlayEl.classList.add("intro-fade-out");

            window.removeEventListener("wheel", preventDefault, { passive: false });
            window.removeEventListener("touchmove", preventDefault, { passive: false });
            window.removeEventListener("keydown", preventScrollKeys, false);
            document.documentElement.classList.remove("intro-lock");

            setTimeout(function () {
                if (overlayEl && overlayEl.parentNode) {
                    overlayEl.parentNode.removeChild(overlayEl);
                }
                if (styleTag && styleTag.parentNode) {
                    styleTag.parentNode.removeChild(styleTag);
                }
            }, FADE_OUT_MS + 50);
        }, remaining);
    }

    /* ---------------------------------------------------------------
       5. 監聽頁面載入完成事件 + 保險逾時
    --------------------------------------------------------------- */
    if (document.readyState === "complete") {
        finishIntro();
    } else {
        window.addEventListener("load", finishIntro, { once: true });
    }
    // 保險：就算某個資源一直載不完，最長等待時間一到也強制結束動畫
    setTimeout(finishIntro, MAX_WAIT_MS);
})();