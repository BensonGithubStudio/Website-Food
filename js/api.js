/* =============================================================
   api.js — 後端 API 溝通層
   內容：CONFIG、apiGet()、apiPost()
   說明：所有模組發送/讀取資料都透過這裡的函式
============================================================= */

/* =============================================================
    後端 API 設定
    部署 .gs 為「網頁應用程式」(Web App) 後，把 /exec 結尾的網址貼在這裡。
    這份 HTML 不再依賴 google.script.run，而是用標準 fetch() 呼叫，
    所以可以直接嵌入 Google Sites，也可以單獨用瀏覽器打開。
============================================================= */
const CONFIG = {
    API_URL: "https://script.google.com/macros/s/AKfycbzlH6PutTT7x770JqL4J1JtL307A9el6xJoAO5jZduYVVNAOdMMkYhUWMetMMXGQ6NZ/exec",
    // 注意：這個逾時只是讓瀏覽器「放棄等待」，不會真的取消 Apps Script 那邊還在執行的程式——
    // 它會在背景繼續跑到完成為止，跑完之後那個執行環境就「熱」了，之後的請求會變快。
    // 所以逾時值設太短、重試又太急，反而可能在冷啟動真正跑完之前就又送出新請求，
    // 變成好幾個請求同時搶資源，情況更糟。這裡把單次逾時拉長、重試間隔拉長，
    // 讓每一次嘗試都有比較充足的時間，把「真的冷啟動、只是比較慢」跟「真的斷線」分開來
    TIMEOUT_MS: 55000,     // 單次請求的逾時上限（原 30000：一批 20 筆地址在 GAS 冷啟動時，
                            // 逐筆查詢 + 節流很容易超過 30 秒，拉長到 55 秒給足時間）
    RETRY_COUNT: 1,        // 讀取類請求逾時/網路錯誤時，自動重試的次數（不含第一次）
    RETRY_DELAY_MS: 5000   // 每次重試之間的間隔（原 3000：拉長讓冷啟動有更多時間穩定下來）
};

function delay_(ms){
    return new Promise(function(resolve){ setTimeout(resolve, ms); });
}

/* 帶逾時機制的 fetch：避免使用者一直卡在「正在載入」畫面，卻不知道到底是還在跑、還是已經卡死了 */
function fetchWithTimeout_(url, options){
    const controller = new AbortController();
    const timer = setTimeout(function(){ controller.abort(); }, CONFIG.TIMEOUT_MS);
    return fetch(url, Object.assign({}, options, { signal: controller.signal }))
        .finally(function(){ clearTimeout(timer); });
}

/* 解析回應：先嘗試解析 JSON，失敗的話（代表收到的可能是 Google 的登入頁或錯誤頁 HTML，
   常見原因是 Apps Script 部署的「存取權限」沒有設成「所有人」）給出明確、可讀的錯誤訊息，
   而不是讓使用者只看到瀏覽器原生的技術性解析錯誤 */
function parseApiResponse_(res){
    return res.text().then(function(text){
        let json;
        try {
            json = JSON.parse(text);
        } catch (e) {
            throw new Error("伺服器回應格式異常，請確認 Apps Script 部署設定（存取權限是否為「所有人」）");
        }
        if (json && json.error) throw new Error(json.error);
        return json;
    });
}

/* 統一的重試邏輯：只用在「讀取」類請求 —— 讀取本身沒有副作用，重試很安全。
   逾時（AbortError）或網路層級的錯誤（fetch 直接 reject，例如離線）才重試；
   後端明確回傳的商業邏輯錯誤（例如「已經收藏過」）不會重試，重試也不會變成功 */
function requestWithRetry_(makeRequest, attemptsLeft){
    return makeRequest().catch(function(error){
        const isRetryable = error.name === "AbortError" || error instanceof TypeError;
        if (isRetryable && attemptsLeft > 0) {
            return delay_(CONFIG.RETRY_DELAY_MS).then(function(){
                return requestWithRetry_(makeRequest, attemptsLeft - 1);
            });
        }
        if (error.name === "AbortError") {
            throw new Error("連線逾時，請檢查網路連線後再試一次");
        }
        throw error;
    });
}

/* 讀取類 API：用 GET + query string，方便快取/除錯。逾時/網路錯誤會自動重試幾次 */
function apiGet(action, params){
    const url = new URL(CONFIG.API_URL);
    url.searchParams.set("action", action);
    Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
    return requestWithRetry_(function(){
        return fetchWithTimeout_(url.toString()).then(parseApiResponse_);
    }, CONFIG.RETRY_COUNT);
}

/* 寫入類 API：用 POST，body 是 JSON 字串。
    Content-Type 刻意用 text/plain，避免瀏覽器送出 CORS 預檢請求（OPTIONS），
    因為 Apps Script 的 Web App 預設不處理 OPTIONS。

    options.retryCount：逾時/網路錯誤時自動重試的次數。預設 0（不重試）——
        不是每個寫入動作重試都安全，重不重試由呼叫端依動作性質自行決定
        （例如「切換最愛」這種非冪等的動作就完全不該傳這個參數）。
    options.onSlow：請求超過 3 秒還沒回應時會被呼叫一次，用來讓呼叫端顯示
        「還在處理中」之類的提示，不管最後有沒有重試都適用。

    回傳的 Promise 若失敗，錯誤物件上會多一個 error.wasRetry：
    true 代表這個錯誤發生在我們自己發動的重試那一次，false/undefined 代表
    第一次請求就失敗了。呼叫端可以用這個資訊判斷：如果重試時收到的錯誤剛好代表
    「這件事其實已經做過了」（例如新增時的「已經收藏過」、刪除時的「找不到該筆資料」），
    很可能代表第一次其實已經送出成功、只是回應逾時，可以放心當作成功處理，
    而不是嚇到使用者說失敗了 */
function apiPost(action, data, options){
    options = options || {};
    const retryCount = options.retryCount || 0;
    const onSlow = options.onSlow;

    function attempt(attemptsLeft, isRetry){
        let slowTimer = null;
        if (onSlow) {
            slowTimer = setTimeout(onSlow, 3000);
        }
        return fetchWithTimeout_(CONFIG.API_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action, data })
        })
            .then(parseApiResponse_)
            .finally(function(){ if (slowTimer) clearTimeout(slowTimer); })
            .catch(function(error){
                const isRetryableNetworkError = error.name === "AbortError" || error instanceof TypeError;
                if (isRetryableNetworkError && attemptsLeft > 0) {
                    return delay_(CONFIG.RETRY_DELAY_MS).then(function(){
                        return attempt(attemptsLeft - 1, true);
                    });
                }
                if (error.name === "AbortError") {
                    error = new Error("連線逾時，請確認網路連線後再試一次");
                }
                error.wasRetry = isRetry;
                throw error;
            });
    }

    return attempt(retryCount, false);
}
