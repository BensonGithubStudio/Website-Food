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
   - 使用者開啟「減少動態效果」時，直接貼齊目標位置，不做追趕動畫
============================================================= */
function initStickyForm(){
    const form = document.querySelector(".desktop-form");
    const container = document.querySelector(".app");
    if(!form || !container) return;

    const desktopQuery = window.matchMedia("(min-width:1024px)");
    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const STICKY_TOP = 76;   // 卡片黏住時，距離視窗頂端的距離
    const EASE = 0.012;       // 追趕速度：0~1，越大追得越快、越貼手，越小越有滑行感
    const SNAP_EPSILON = 0.4; // 差距小於這個值就視為已貼齊，停止動畫、節省效能

    let originalDocTop = 0;    // 卡片「正常排版」時，距離文件頂端的距離
    let currentOffset = 0;     // 目前實際套用在卡片上的位移量
    let rafId = null;

    // 量測卡片正常排版時的位置。量測前先暫時拿掉目前的位移，
    // 才能量到卡片「真正」該在的位置，量完再把位移還原回去
    function measure(){
        const prevTransform = form.style.transform;
        form.style.transform = "";
        const rect = form.getBoundingClientRect();
        originalDocTop = rect.top + window.scrollY;
        form.style.transform = prevTransform;
    }

    // 算出「現在」理論上應該要有多少位移量，才能讓卡片貼在畫面頂端 STICKY_TOP 的位置
    function targetOffset(){
        const naturalTop = originalDocTop - window.scrollY; // 完全不做任何事的話，卡片現在會在畫面的哪個高度
        if(naturalTop >= STICKY_TOP){
            return 0; // 卡片自然位置還沒捲到頂端上面，不用推，跟著頁面自然捲動就好
        }
        let offset = STICKY_TOP - naturalTop;

        // 邊界檢查：不要讓卡片被推出所在那一列的底部之外（避免捲到最後，
        // 卡片還黏在畫面上、蓋住已經捲出畫面外的內容）
        const containerBottomDocY = container.getBoundingClientRect().bottom + window.scrollY;
        const maxOffset = Math.max(0, (containerBottomDocY - form.offsetHeight) - originalDocTop);
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

    function syncWithBreakpoint(){
        if(desktopQuery.matches){
            enable();
        } else {
            disable();
        }
    }

    syncWithBreakpoint();

    // 對外暴露：讓 food-crud.js 在店家列表重新渲染（新增／編輯／刪除／篩選後）
    // 呼叫，重新量測卡片「正常排版」的位置。
    // 原因：originalDocTop 只有在初始化跟 resize 時才會重新量測；如果列表高度
    // 因為新增/刪除資料而改變，卡片實際該在的位置也跟著變了，但這個函式如果不
    // 被呼叫，就還在用舊的 originalDocTop 換算位移，導致卡片位置跳掉、
    // 看起來像整個畫面詭異地往下滑動。
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
