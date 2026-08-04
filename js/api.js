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
    API_URL: "https://script.google.com/macros/s/AKfycbw5sy8mDGTVX0XRoxLWOsVIRV5qiD8wWT2GmHfz7uXiPhESUDMl-YxMB2VYA689oomL/exec",
    TIMEOUT_MS: 20000,     // 單次請求的逾時上限：Apps Script 網頁應用程式偶爾會有冷啟動延遲
    RETRY_COUNT: 2,        // 讀取類請求逾時/網路錯誤時，自動重試的次數（不含第一次）
    RETRY_DELAY_MS: 1500   // 每次重試之間的間隔
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
    這裡刻意不自動重試：萬一是伺服器其實已經處理成功、只是回應逾時，
    自動重試可能會造成「切換最愛」被連按兩次、或重複新增等副作用，
    逾時就直接讓使用者看到明確訊息，由使用者自己決定要不要再按一次 */
function apiPost(action, data){
    return fetchWithTimeout_(CONFIG.API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, data })
    })
        .then(parseApiResponse_)
        .catch(function(error){
            if (error.name === "AbortError") {
                throw new Error("連線逾時，請確認網路連線後再試一次");
            }
            throw error;
        });
}
