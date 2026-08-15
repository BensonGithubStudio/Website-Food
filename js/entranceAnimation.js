/* ======================================================================
   entranceAnimation.js
   主畫面元素的「登場動畫」（獨立檔案，不與 introAnimation.js 合併）

   使用方式：
   跟 introAnimation.js 一樣，放在 <body> 開始標籤之後、
   其餘畫面內容（.food-bg 等）之前，也「不要」加上 defer 或 async：

   <body>
       <script src="introAnimation.js"></script>
       <script src="entranceAnimation.js"></script>
       <div class="food-bg" ...> ... </div>
       ...

   行為說明：
   - 一開始就先用注入的 CSS 把「要登場的元素」設成透明 + 些微位移／傾斜／
     縮小的初始狀態，這樣才不會讓使用者看到畫面先正常顯示、才突然被動畫
     蓋過去一次的閃爍感。
   - 視覺概念是「一疊照片被輕輕抽出、滑放定位」：每個元素一開始像疊在
     附近、帶一點小角度傾斜、底下透出淡淡陰影，接著平順地滑到定位、
     角度歸零、陰影收起，質感偏安靜內斂，不誇張、不彈跳翻滾。
   - 位移量刻意壓得很小（20~50px）、旋轉角度也很小（2~7 度），加上
     ease-out 的平順曲線，讓整體節奏像高品質相片牆的排版動畫，而不是
     元素從畫面外飛進來的浮誇效果。
   - 等「頁面所有資源載入完成（window.load）」之後，再多等 START_DELAY_MS
     才開始播放，讓畫面先安靜一下、登場的瞬間更有節奏感，不會跟開場遮罩
     淡出的動作黏在一起搶戲。
   - 每個元素可各自設定方向、傾斜角度，讀起來像一份小小的「演出流程表」，
     之後要新增/調整登場元素也很好改。
   - 播放順序改成「依序」登場：CAST 陣列由上到下就是登場順序，每個元素
     開始的時間點 = 前一個元素的順序 * STAGGER_INTERVAL_MS，而不是各自
     寫死的秒數。只要調整最上面的 STAGGER_INTERVAL_MS 這一個數字，就能
     一次改變全部元素之間的間隔節奏（數字越大，一個接一個的感覺越明顯；
     設成比 dur 還大，就會變成完全等前一個播完才開始下一個）。
   - 尊重 prefers-reduced-motion：使用者關閉動態效果時，元素直接正常顯示。
   - 動畫播完後會自動「歸還控制權」：拿掉 data-entrance 屬性跟相關的 CSS
     變數，讓這裡注入的樣式／animation 完全停止作用在該元素身上。這點很
     重要，因為 CSS animation 的 fill-mode:both 在動畫結束後仍會持續套用
     結束那一格 keyframe 的 transform，優先度又比一般的 inline style 高，
     若不清掉，會讓其他之後才要控制同一個元素 transform 的腳本（例如桌機
     版新增餐廳卡片的黏性捲動 sticky-form.js）永遠被蓋掉、看起來像失效。
   ====================================================================== */

(function () {
    "use strict";

    if (!document || !document.documentElement) return;

    // ---------- 頁面載入完成後，要再等多久才開始播放登場動畫 ----------
    var START_DELAY_MS = 2300;
    // ---------- 保險逾時：萬一 load 事件遲遲沒觸發，最長等這麼久就強制播放 ----------
    var FALLBACK_MS = 8000;

    // ---------- 依序登場的間隔時間（毫秒）：這是「自己設定間隔」的唯一入口 ----------
    // CAST 陣列第 N 個元素（從 0 算起）會在 N * STAGGER_INTERVAL_MS 這個時間點開始播放。
    // 想要「明顯一個接一個」→ 調大這個數字（例如 300~450）。
    // 想要「稍微重疊、比較緊湊」→ 調小這個數字（例如 80~150）。
    // 想要「完全等前一個播完才開始下一個」→ 設成 >= 該元素的 dur（單位需自行換算成毫秒）。
    var STAGGER_INTERVAL_MS = 180;

    var played = false;

    // 是否開啟「減少動態效果」——開啟時完全不播放動畫，也不需要等
    // animationend，直接立刻歸還控制權即可
    var reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    // 記錄所有被標記過 data-entrance 的元素，播放完後要逐一清掉標記，
    // 把 transform/opacity 的控制權還給其他腳本（見上方說明）
    var decoratedEls = [];

    /* ---------------------------------------------------------------
       0. 手機版／電腦版判斷：手機的畫面比較窄、資訊也比較密，不需要
          把電腦版那一整排功能（搜尋框、只看最愛、地圖檢視、風格色票、
          新增餐廳表單）都做一次登場動畫，只保留最上面最重要的幾個
          元素（logo、標題、副標題、幾間餐廳數字、排序）+ 底部工具列；
          電腦版則反過來不需要播放底部工具列（本來就是 display:none）。

          斷點跟 style.css 裡「手機／電腦版」切換的斷點（767px / 768px，
          例如 .desktop-form、.mobile-tab-bar 的 media query）保持一致。
          這裡只在腳本啟動當下判斷一次（不隨視窗縮放即時切換），
          跟登場動畫「只在頁面一開始播放一次」的設計是一致的。
       --------------------------------------------------------------- */
    var isMobileViewport = window.matchMedia("(max-width: 767px)").matches;

    /* ---------------------------------------------------------------
       1. 演出流程表：每個要登場的元素、從哪個小方向／小角度／小縮放
          滑入。陣列的「順序」本身就代表登場順序，不用再手動幫每個元素
          寫死延遲秒數——實際的延遲時間會在下面用 STAGGER_INTERVAL_MS
          自動算出來（第一個元素 0 秒開始，第二個元素等一個間隔，以此
          類推，且是在依「手機／電腦版」過濾完清單之後才計算，所以
          兩邊各自的節奏都是緊接著播，不會因為對方版本專屬的元素而
          被插入一段不動的空白間隔）。

          每一項多了一個 scope 欄位，標記這個元素「只在哪個版本」登場：
            - "all"：兩邊都播（目前是最上面共用的幾個元素）
            - "desktop"：只有電腦版播（手機版看不到這些功能列）
            - "mobile"：只有手機版播（電腦版看不到底部工具列）
          這樣手機版和電腦版會各自從 CAST_FULL 過濾出「只屬於自己」的
          清單，不會出現「幫另一個版本占位、自己卻沒東西可播」而卡住
          一段時間的狀況。

          x / y 是滑入前的位移量（px，數值刻意壓小，只是「疊在旁邊」的
          感覺，不是從螢幕外飛入）；rot 是傾斜角度（度數，同樣壓小）；
          scale 是滑入前的縮放比例（接近 1，只是稍微縮小一點點）；
          dur 是這個元素自己的動畫時間長度（秒）。
       --------------------------------------------------------------- */
    var CAST_FULL = [
        // 左上角 logo：像疊放在左上方，帶一點小角度
        { sel: ".logo",             scope: "all",     x: -50, y: -35, rot: -7,  scale: .92, dur: 1.35 },
        // 「美食口袋名單」標題
        { sel: ".brand h1",         scope: "all",     x: -46, y: 32,  rot: -13, scale: .94, dur: 1.38 },
        // 「收藏你的美味回憶」副標題
        { sel: ".brand p",          scope: "all",     x: -36, y: 27,  rot: 5,   scale: .95, dur: 1.31 },
        // 右上角「幾間餐廳」數字方塊：從右側小幅疊入，跟 logo 呼應
        { sel: ".count-box",        scope: "all",     x: 50,  y: -33, rot: 8,   scale: .92, dur: 1.32 },
        // 搜尋框（僅電腦版播放，手機版搜尋收在底部工具列的圖示按鈕）
        { sel: ".search-box",       scope: "desktop", x: -53, y: 23,  rot: -3,  scale: .94, dur: 1.36 },
        // 只看最愛按鈕（僅電腦版播放，手機版是底部工具列的圖示按鈕）
        { sel: "#favFilterBtn",     scope: "desktop", x: 26,  y: 30,  rot: 5,   scale: .92, dur: 1.3 },
        // 地圖檢視按鈕（僅電腦版播放，手機版是底部工具列的圖示按鈕）
        { sel: "#mapViewBtn",       scope: "desktop", x: -26, y: 30,  rot: -5,  scale: .92, dur: 1.3 },
        // 排序介面
        { sel: ".sort-bar",         scope: "all",     x: 0,   y: 28,  rot: -3,  scale: .95, dur: 1.39 },
        // 底部工具列本身（僅手機版顯示，電腦版是 display:none）：
        // 整條從螢幕下方稍微滑上來、帶一點點傾斜，像玻璃托盤被放上桌
        { sel: ".mobile-tab-bar", scope: "mobile", x: 0, y: 46, rot: -3, scale: .94, dur: 1.32 },
        // 工具列裡的 5 個圖示按鈕，各自從中央新增鍵向左右對稱扇形小幅展開，
        // 呈現「一個個彈出定位」的感覺，而不是整排一起僵硬地出現
        { sel: ".mobile-tab-bar .mobile-tab-btn:nth-child(1)", scope: "mobile", x: -22, y: 26, rot: -6, scale: .9,  dur: 1.22 }, // 搜尋
        { sel: "#mobileFavBtn",                                scope: "mobile", x: -11, y: 24, rot: 4,  scale: .91, dur: 1.24 }, // 我的最愛
        { sel: ".mobile-tab-btn--add",                         scope: "mobile", x: 0,   y: 30, rot: 0,  scale: .88, dur: 1.3 },  // 新增餐廳（中央主按鈕，幅度稍大）
        { sel: "#mobileMapBtn",                                scope: "mobile", x: 11,  y: 24, rot: -4, scale: .91, dur: 1.24 }, // 地圖
        { sel: "#mobileThemeBtn",                              scope: "mobile", x: 22,  y: 26, rot: 6,  scale: .9,  dur: 1.22 }, // 切換風格
        // 風格色票列（僅電腦版播放，手機版是底部工具列的圖示按鈕）
        { sel: ".theme-picker-bar", scope: "desktop", x: 0,   y: 30,  rot: 3,   scale: .95, dur: 1.3 },
        // 左側「新增餐廳」卡片（電腦版才顯示，手機版本來就是 display:none，
        // 手機版也一併從清單排除，動畫時序不用等它）
        { sel: ".desktop-form",     scope: "desktop", x: -60, y: 36,  rot: -4,  scale: .93, dur: 1.3 }
    ];

    // 依目前是手機版還電腦版，只留下「兩邊都播（all）」+「當前版本專屬」的項目，
    // 對方版本專屬的元素完全從清單移除，不會佔用 stagger 的延遲格次、
    // 也不會在畫面上造成看不見卻仍被計入節奏的空白等待。
    var CAST = CAST_FULL.filter(function (item) {
        if (item.scope === "all") return true;
        return isMobileViewport ? item.scope === "mobile" : item.scope === "desktop";
    });

    // 依照上面陣列的順序，自動算出每個元素要延遲多久才開始播放：
    // 第 0 個 0 秒、第 1 個等 1 個間隔、第 2 個等 2 個間隔……以此類推。
    // 之後想個別微調某個元素的節奏，也可以直接在 CAST 裡幫該項目加上
    // 自訂的 delay（秒），下面的自動計算只會補上「沒有手動設定 delay」的項目。
    CAST.forEach(function (item, index) {
        if (typeof item.delay !== "number") {
            item.delay = (index * STAGGER_INTERVAL_MS) / 1000;
        }
    });

    /* ---------------------------------------------------------------
       2. 注入樣式：定義初始隱藏狀態 + 共用的登場 keyframe。
          用 CSS 變數帶入每個元素各自的位移／旋轉／縮放／延遲，
          這樣只需要一組 @keyframes 就能做出不同的登場效果。
       --------------------------------------------------------------- */
    var styleTag = document.createElement("style");
    styleTag.id = "entranceAnimationStyle";
    styleTag.textContent = [
        // 這裡故意把選擇器重複寫三次（[data-entrance][data-entrance][data-entrance]）
        // 只是為了「拉高 CSS 優先度」，不是筆誤：某些元素本身在 style.css 裡有自己的
        // 狀態樣式（例如「地圖檢視」按鈕在資料定位中會是 .map-view-btn:disabled，
        // 設定了 opacity:.5），這類「class + 偽類」的選擇器優先度比單純的屬性選擇器
        // 高，會蓋掉這裡想要的「完全透明」初始狀態，導致動畫播放前元素其實是半透明
        // 可見的。刻意堆疊到這裡三個屬性選擇器疊加後優先度足夠高，就能確保不管該
        // 元素本身有沒有 disabled、active 之類的狀態樣式，動畫播放前都會確實是完全
        // 透明。注意這裡沒有用 !important——若用了 !important，會連動畫本身要把
        // opacity 從 0 動畫到 1 的效果也一起擋住，導致播放時卡在透明狀態動不了。
        "[data-entrance][data-entrance][data-entrance] {",
        "    opacity:0;",
        "    transform:",
        "        translate(var(--ent-x, 0px), var(--ent-y, 16px))",
        "        scale(var(--ent-scale, .94))",
        "        rotate(var(--ent-rot, 0deg));",
        // 這裡的 will-change 其實只是備援：decorate() 已經用「永久」的 inline
        // will-change 蓋過它了（cleanup 時不會被拿掉，見 decorate() 註解），
        // 這條 CSS 規則只是保底，避免萬一 JS 那行沒跑到時，動畫播放中還是
        // 有基本的合成層優化，不影響前面提到的定位跳動修正。
        "    will-change:opacity, transform, filter;",
        "}",
        "html.entrance-play [data-entrance] {",
        "    animation-name:entrancePhoto;",
        "    animation-duration:var(--ent-dur, .6s);",
        // ease-out-expo：一路平順減速、沒有來回甩動，質感比較安靜內斂
        "    animation-timing-function:cubic-bezier(.16, 1, .3, 1);",
        "    animation-delay:var(--ent-delay, 0s);",
        "    animation-fill-mode:both;",
        "}",
        // 像一張照片被輕輕從旁邊的疊放位置抽出、滑放到定位：
        // 起始帶一點小角度、小位移、稍微縮小，並用陰影暗示它「疊在上層」；
        // 滑動過程只在中段留一個非常輕的 overshoot（1%的縮放/角度）
        // 做出「輕輕放下」的落定感，最後陰影收起、完全貼合版面。
        "@keyframes entrancePhoto {",
        "    0% {",
        "        opacity:0;",
        "        transform:",
        "            translate(var(--ent-x, 0px), var(--ent-y, 16px))",
        "            scale(var(--ent-scale, .94))",
        "            rotate(var(--ent-rot, 0deg));",
        "        filter:drop-shadow(0 14px 22px rgba(20, 14, 8, .22));",
        "    }",
        "    62% {",
        "        opacity:1;",
        "        transform:",
        "            translate(calc(var(--ent-x, 0px) * 0.06), calc(var(--ent-y, 16px) * 0.06))",
        "            scale(1.012)",
        "            rotate(calc(var(--ent-rot, 0deg) * -0.08));",
        "        filter:drop-shadow(0 6px 10px rgba(20, 14, 8, .1));",
        "    }",
        "    100% {",
        "        opacity:1;",
        "        transform:translate(0, 0) scale(1) rotate(0deg);",
        "        filter:drop-shadow(0 0 0 rgba(0, 0, 0, 0));",
        "    }",
        "}",
        // 找不到某個元素、或這份名單以外的畫面內容完全不受影響，只有加了
        // data-entrance 屬性的元素才會被初始隱藏，避免影響其他版面。
        "@media (prefers-reduced-motion: reduce) {",
        "    [data-entrance] {",
        "        opacity:1 !important;",
        "        transform:none !important;",
        "        filter:none !important;",
        "        animation:none !important;",
        "    }",
        "}"
    ].join("\n");
    document.head.appendChild(styleTag);

    /* ---------------------------------------------------------------
       3. 幫演出名單裡的每個元素標記 data-entrance + 對應的 CSS 變數。
          用 MutationObserver 加上輪詢兩種方式確保就算元素還沒被瀏覽器
          解析出來，也能在它出現的當下立刻補上初始狀態，不會漏掉。
       --------------------------------------------------------------- */
    var pendingSelectors = CAST.slice();

    function decorate(el, item) {
        if (!el || el.hasAttribute("data-entrance")) return;
        el.setAttribute("data-entrance", "");
        el.style.setProperty("--ent-x", item.x + "px");
        el.style.setProperty("--ent-y", item.y + "px");
        el.style.setProperty("--ent-rot", item.rot + "deg");
        el.style.setProperty("--ent-scale", item.scale);
        el.style.setProperty("--ent-delay", item.delay + "s");
        el.style.setProperty("--ent-dur", item.dur + "s");
        // 用「永久」的 inline will-change（不綁在 data-entrance 屬性上，
        // cleanup 時也不會被拿掉），讓瀏覽器從動畫開始前就把這個元素拉去
        // 獨立的合成層繪製，並且「全程」待在那個合成層、不會在動畫播完、
        // cleanupElement() 拿掉 data-entrance 屬性的那一刻被踢出去。
        // 如果沒有這行，元素會在 cleanup 那一瞬間從合成層繪製切回一般版面
        // 繪製，即使 transform 數值前後完全等價，瀏覽器算次像素（subpixel）
        // 的方式仍可能有極些微差異，肉眼會看到像是動畫播完後又「重新定位」
        // 跳了一下（尤其文字元素最明顯）。持續佔用一個小合成層的效能成本，
        // 對這裡這十幾個元素來說可以忽略不計。
        el.style.willChange = "transform, opacity, filter";
        decoratedEls.push(el);
    }

    function tryDecorateAll() {
        pendingSelectors = pendingSelectors.filter(function (item) {
            var el = document.querySelector(item.sel);
            if (el) {
                decorate(el, item);
                return false; // 已處理，從待處理名單移除
            }
            return true; // 元素還沒出現，之後再試
        });
        return pendingSelectors.length === 0;
    }

    // 立刻先跑一次（大多數情況下這支腳本放在內容之前，這裡通常抓不到，屬正常現象）
    tryDecorateAll();

    var observer = null;
    if (window.MutationObserver) {
        observer = new MutationObserver(function () {
            if (tryDecorateAll() && observer) {
                observer.disconnect();
                observer = null;
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    // 保險：DOM 解析完成後再確認一次，避免極少數情況下 MutationObserver 漏抓
    document.addEventListener("DOMContentLoaded", tryDecorateAll, { once: true });

    /* ---------------------------------------------------------------
       3.5 動畫播完後的清理：拿掉 data-entrance 屬性 + 相關 CSS 變數，
           讓這支腳本注入的樣式／animation 完全退場，不再影響該元素。

           注意：故意「不」清掉 decorate() 那裡設定的 inline will-change。
           它是刻意留著的，讓元素從動畫開始前到動畫播完之後都待在同一個
           合成層裡，不會因為 will-change 被拿掉而在 cleanup 那一刻切回
           一般版面繪製、造成肉眼可見的「重新定位」跳動（細節見 decorate()
           裡的註解）。
       --------------------------------------------------------------- */
    function cleanupElement(el) {
        if (!el || !el.hasAttribute("data-entrance")) return;
        el.removeAttribute("data-entrance");
        el.style.removeProperty("--ent-x");
        el.style.removeProperty("--ent-y");
        el.style.removeProperty("--ent-rot");
        el.style.removeProperty("--ent-scale");
        el.style.removeProperty("--ent-delay");
        el.style.removeProperty("--ent-dur");
    }

    // 播放開始後才呼叫：幫每個元素掛上「動畫播完就清理」的監聽，
    // 減少動態效果時則不會有動畫可等，直接立刻清理即可。
    function releaseControlAfterPlay() {
        var maxFinishMs = 0;

        decoratedEls.forEach(function (el) {
            if (reduceMotionQuery.matches) {
                cleanupElement(el); // 沒有動畫可播，直接歸還控制權
                return;
            }

            var delaySec = parseFloat(el.style.getPropertyValue("--ent-delay")) || 0;
            var durSec = parseFloat(el.style.getPropertyValue("--ent-dur")) || 0;
            maxFinishMs = Math.max(maxFinishMs, (delaySec + durSec) * 1000);

            el.addEventListener("animationend", function onEnd(e) {
                if (e.target !== el) return; // 忽略子元素冒泡上來的 animationend
                el.removeEventListener("animationend", onEnd);
                cleanupElement(el);
            });
        });

        // 保險逾時：萬一某個元素因為特殊狀況（例如播放當下被 display:none
        // 藏起來）沒有確實觸發 animationend，最長等到全部動畫理論上都已
        // 播完，再加一點緩衝時間，強制清掉還殘留的 data-entrance，避免
        // transform 永遠卡住、擋到其他腳本（例如 sticky-form.js）接手。
        setTimeout(function () {
            decoratedEls.forEach(cleanupElement);
        }, maxFinishMs + 400);
    }

    /* ---------------------------------------------------------------
       4. 播放登場動畫（只會真正播放一次）。
       --------------------------------------------------------------- */
    function playEntrance() {
        if (played) return;
        played = true;

        if (observer) {
            observer.disconnect();
            observer = null;
        }
        tryDecorateAll(); // 播放前最後補一次，確保全部元素都已標記好初始狀態

        // 用 requestAnimationFrame 讓瀏覽器先把「初始隱藏狀態」畫出來一次，
        // 下一幀再加上 entrance-play class 觸發動畫，animation 才會確實播放，
        // 不會因為狀態切換太快被瀏覽器直接合併、跳過該有的過場效果。
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                document.documentElement.classList.add("entrance-play");
                releaseControlAfterPlay();
            });
        });
    }

    /* ---------------------------------------------------------------
       5. 觸發時機：頁面完全載入完成（window.load）之後，
          再等 START_DELAY_MS 才開始播放登場動畫。
       --------------------------------------------------------------- */
    function scheduleEntrance() {
        setTimeout(playEntrance, START_DELAY_MS);
    }

    if (document.readyState === "complete") {
        // 腳本執行時 load 事件其實已經觸發過了（例如腳本被延後載入的情況），
        // 這裡就直接照樣等滿 START_DELAY_MS 再播放，行為保持一致。
        scheduleEntrance();
    } else {
        window.addEventListener("load", scheduleEntrance, { once: true });
    }

    // 保險：極少數情況下 load 事件異常沒有觸發，最長等這麼久還是要強制播放，
    // 避免內容永遠停在透明看不到的狀態。
    setTimeout(playEntrance, FALLBACK_MS);
})();
