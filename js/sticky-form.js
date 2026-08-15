/* =============================================================
   sticky-form.js — 桌機版「新增餐廳」卡片的黏性回歸效果
   內容：initStickyForm()

   行為說明：
   - 卡片全程留在正常的文件排版流裡（不會切換成 fixed／不會脫離 grid），
     所以捲動時会先跟著頁面自然移動，就像完全沒被處理過一樣
   - 當它自然的位置快要捲出畫面上緣時，才用 transform:translateY() 把它「推」回
     畫面上緣附近；這個推回去的位移量是用一點阻尼（lerp）慢慢追上目標值，
     而不是瞬間貼齊，所以會有一種捲動放手後、卡片自己滑回定位的感覺
   - 卡片本身沒有離開它在 grid 裡原本的欄位／格子，因此不會發生「卡片變成
     fixed 後被瀏覽器踢出 grid 排版計算，導致右側清單被擠到左邊」的問題
   - 也會考慮所在那一列（.app）的下緣，捲到最底部時不會整張卡黏著卡在畫面上，
     會自然跟著露出下面的邊界，行為上比較接近原生 position:sticky
   - 只在桌機雙欄版面（≥1024px）啟用；手機/平板本來就是 display:none，不受影響；
     縮小視窗離開桌機寬度時會自動停用、清掉監聽器跟位移
   - 貼住時的目標高度會依「視窗高度」動態調整（effectiveStickyTop()）：螢幕較矮/較扁、
     卡片比視窗還高時，不會死守 STICKY_TOP，而是改成讓卡片底部貼齊視窗下緣，犧牲
     頂端捲出畫面外，確保送出按鈕等底部內容在任何捲動位置都進得了看得到的範圍
   - 使用者開啟「減少動態效果」時，直接貼齊目標位置，不做追趕動畫
   - 用 ResizeObserver 監看 .app 容器，只要版面高度實際變化（排序重排、
     篩選筆數變動、圖片載入撐高卡片……）就自動重新量測卡片位置，不必
     再依賴外部程式碼在每個可能改變版面的地方都記得手動呼叫
     window.refreshStickyForm()（該函式仍保留，作為明確保底/舊瀏覽器
     的後備管道）
   - 也監聽 transitionend／animationend：頁面剛載入時若有進場動畫（例如
     entranceAnimation.js 讓卡片淡入/位移彈出），量測當下如果動畫還沒播完，
     getBoundingClientRect() 量到的會是「還沒定位好」的暫時位置。這兩個
     事件保證動畫播完的當下一定會收到通知，藉此再量一次，避免第一次
     載入／重新整理時卡片貼齊的距離跑掉
============================================================= */
function initStickyForm(){
    const form = document.querySelector(".desktop-form");
    const container = document.querySelector(".app");
    if(!form || !container) return;

    const desktopQuery = window.matchMedia("(min-width:1024px)");
    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const STICKY_TOP = 10;   // 卡片黏住時，距離視窗頂端的距離
    const EASE = 0.012;       // 追趕速度：0~1，越大追得越快、越貼手，越小越有滑行感
    const SNAP_EPSILON = 0.4; // 差距小於這個值就視為已貼齊，停止動畫、節省效能
    const BOTTOM_SAFE_MARGIN = 5; // 卡片最多只能貼到「距離整頁底部」還留這麼多空白，避免整個卡片剛好頂到頁面最尾端

    let originalDocTop = 0;    // 卡片「正常排版」時，距離文件頂端的距離
    let currentOffset = 0;     // 目前實際套用在卡片上的位移量
    let rafId = null;
    let resizeObserver = null;
    let pendingRemeasureRafId = null; // 節流用：ResizeObserver／transitionend／animationend 共用

    // 量測卡片正常排版時的位置。量測前先暫時拿掉目前的位移，
    // 才能量到卡片「真正」該在的位置，量完再把位移還原回去
    function measure(){
        const prevTransform = form.style.transform;
        form.style.transform = "";
        const rect = form.getBoundingClientRect();
        originalDocTop = rect.top + window.scrollY;
        form.style.transform = prevTransform;
    }

    // 算出卡片「貼住時」頂端該落在畫面的哪個高度。
    //
    // 平常直接回傳 STICKY_TOP 就好，但如果卡片本身比視窗還高（螢幕比較矮、比較扁，
    // 或視窗沒有全螢幕），死守 STICKY_TOP 會讓卡片下半部（尤其是送出按鈕）整段
    // 捲動過程都被推出畫面下緣、按不到，而且不會像原生 position:sticky 那樣在容器
    // 快捲完時「放手」讓底部露出來。
    //
    // 做法：改成取 STICKY_TOP 跟「視窗高度扣掉底部安全邊界、再扣掉卡片高度」兩者
    // 中比較小的那個。卡片比視窗矮時，後者比較大，取到的還是 STICKY_TOP，行為完全
    // 不變；卡片比視窗高時，後者會是負值，讓卡片頂端主動被推到畫面外，換成底部
    // 貼齊視窗下緣，這樣按鈕才能隨時進到看得到、按得到的範圍內。
    function effectiveStickyTop(){
        const viewportAvailable = window.innerHeight - BOTTOM_SAFE_MARGIN - form.offsetHeight;
        return Math.min(STICKY_TOP, viewportAvailable);
    }

    // 算出「現在」理論上應該要有多少位移量，才能讓卡片貼在畫面頂端 effectiveStickyTop() 的位置
    function targetOffset(){
        const stickyTop = effectiveStickyTop();
        const naturalTop = originalDocTop - window.scrollY; // 完全不做任何事的話，卡片現在會在畫面的哪個高度
        if(naturalTop >= stickyTop){
            return 0; // 卡片自然位置還沒捲到目標線上面，不用推，跟著頁面自然捲動就好
        }
        let offset = stickyTop - naturalTop;

        // 邊界檢查：不要讓卡片被推出「整份頁面」的底部之外。
        //
        // 這裡刻意不用 container(.app) 或右側清單(#foodContainer) 的
        // getBoundingClientRect() 來當邊界——因為 .app 是 CSS Grid，
        // 左側表單跟右側店家清單共用同一個 grid row，這個 row 的高度
        // 永遠等於「兩欄之中比較高的那一欄」。一旦右側清單因為搜尋／
        // 篩選／筆數變動而變得比表單矮，這個 row（也就是 container）
        // 的高度就會反過來被表單自己的高度決定，等於是拿表單自己的
        // 高度去反推允許它移動的空間，導致算出來的上限忽大忽小，
        // STICKY_TOP 看起來就會隨著右側卡片大小而有落差。
        //
        // 改成用整份文件的實際高度當底線後，卡片能不能貼滿 STICKY_TOP，
        // 只跟目前的捲動位置、以及頁面是否即將捲完有關，不再受右側清單
        // 目前渲染出幾張卡片、卡片多高影響。
        const docBottomDocY = Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight
        );
        const maxOffset = Math.max(0, docBottomDocY - BOTTOM_SAFE_MARGIN - form.offsetHeight - originalDocTop);
        return Math.min(offset, maxOffset);
    }

    function loop(){
        const target = targetOffset();

        if(reduceMotionQuery.matches){
            currentOffset = target; // 減少動態效果：直接貼齊，不做追趕動畫
        } else {
            currentOffset += (target - currentOffset) * EASE;
        }

        if(Math.abs(target - currentOffset) < SNAP_EPSILON){
            currentOffset = target;
            form.style.transform = currentOffset ? `translateY(${currentOffset.toFixed(1)}px)` : "";
            rafId = null; // 已經貼合到位，先停下動畫迴圈，等下次捲動再喚醒，避免持續佔用效能
            return;
        }

        form.style.transform = `translateY(${currentOffset.toFixed(1)}px)`;
        rafId = requestAnimationFrame(loop);
    }

    function wake(){
        if(!desktopQuery.matches) return;
        if(rafId === null){
            rafId = requestAnimationFrame(loop);
        }
    }

    function onScroll(){
        wake();
    }
    function onResize(){
        measure();
        wake();
    }

    function enable(){
        measure();
        window.addEventListener("scroll", onScroll, { passive:true });
        window.addEventListener("resize", onResize);
        wake();
    }

    function disable(){
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onResize);
        if(rafId !== null){
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        currentOffset = 0;
        form.style.transform = "";
    }

    // 節流過的「重新量測」：不管是 ResizeObserver 還是 transitionend／
    // animationend 觸發，同一輪 layout 變化都可能連續觸發多次，
    // 合併成下一影格只量測一次即可
    function scheduleRemeasure(){
        if(pendingRemeasureRafId !== null) return;
        pendingRemeasureRafId = requestAnimationFrame(function(){
            pendingRemeasureRafId = null;
            measure();
            wake();
        });
    }

    // 監看 .app 整個容器的實際尺寸變化，自動重新量測卡片位置。
    //
    // 為什麼需要這個：原本 originalDocTop 只有在 init／resize／外部程式碼
    // 手動呼叫 window.refreshStickyForm() 時才會重新量測。但排序、篩選、
    // 圖片非同步載入撐高卡片……任何會改變版面高度的操作，都得靠對應的
    // 程式碼「記得」去呼叫 refreshStickyForm，一旦漏掉、或呼叫的時機只用了
    // 一次 requestAnimationFrame（不一定來得及等到瀏覽器把換行、字型、
    // entrance 動畫等 reflow 全部定案），量到的就會是舊的／量早的位置，
    // 卡片貼齊的距離就會跟 STICKY_TOP 兜不起來。
    //
    // ResizeObserver 是瀏覽器保證：只要被觀察的元素「實際渲染尺寸」真的
    // 變了，排版完成後就會收到通知，不必再靠外部程式碼自覺呼叫、也不受
    // 單一 rAF 是否搶得到時機影響。
    function setupAutoRefresh(){
        if(resizeObserver || typeof ResizeObserver === "undefined") return;
        resizeObserver = new ResizeObserver(scheduleRemeasure);
        resizeObserver.observe(container);

        // 補上 ResizeObserver 量不到的情況：卡片（或它的祖先，例如整個
        // .app、頁面剛載入時的進場動畫容器）身上如果有 CSS transition／
        // animation 讓它用 transform／opacity 位移淡入，這種效果不會改變
        // 元素的實際佔位尺寸，ResizeObserver 不會觸發，但 getBoundingClientRect()
        // 量到的位置仍然會受影響（量到「動畫播到一半」的暫時位置）。
        // transitionend／animationend 保證動畫播完一定會收到通知，用捕獲
        // 階段監聽在 document 上，這樣不管動畫發生在卡片本身還是它的
        // 任何祖先元素身上都能捕捉到，不必知道進場動畫實際上是怎麼實作的。
        document.addEventListener("transitionend", scheduleRemeasure, true);
        document.addEventListener("animationend", scheduleRemeasure, true);
    }

    function syncWithBreakpoint(){
        if(desktopQuery.matches){
            enable();
        } else {
            disable();
        }
    }

    syncWithBreakpoint();
    setupAutoRefresh();

    // 額外保底：頁面剛載入時，圖片／字型／進場動畫都可能讓卡片位置在
    // 一開始的幾百毫秒內持續變動，而且不保證都是透過 CSS transition／
    // animation 實作（例如直接用 JS 每一影格手動改 transform 的進場效果，
    // 就不會觸發 transitionend／animationend）。這裡在 window 完全載入、
    // 以及載入後再等一小段時間，各補量一次，涵蓋這類抓不到事件的情況。
    window.addEventListener("load", scheduleRemeasure);
    setTimeout(scheduleRemeasure, 800);

    // 對外暴露：保留給 food-crud.js 等舊呼叫點在店家列表重新渲染（新增／
    // 編輯／刪除／篩選／排序後）主動呼叫，作為明確的即時保底手段——
    // 大部分情況下其實已經由上面的 ResizeObserver 自動處理，但保留這個
    // 手動呼叫的管道：一來對舊瀏覽器（沒有 ResizeObserver）仍然有效，
    // 二來需要「馬上」重新量測、不想等 ResizeObserver 那一輪節流時還是能用。
    window.refreshStickyForm = function(){
        measure();
        wake();
    };

    // 監聽斷點切換（例如使用者把視窗從桌機寬度縮小到平板寬度），即時啟用/停用整個效果
    if(desktopQuery.addEventListener){
        desktopQuery.addEventListener("change", syncWithBreakpoint);
    } else if(desktopQuery.addListener){
        // 少數較舊瀏覽器只支援這個寫法
        desktopQuery.addListener(syncWithBreakpoint);
    }
}
