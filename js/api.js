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
    API_URL: "https://script.google.com/macros/s/AKfycbzFiQLO8g9FZrnfDxPZJFkIE5ccJ5UnrvJ86V5EKJUPwR74xnmgoobpjGBUc_E_DNVZ/exec"
};

/* 讀取類 API：用 GET + query string，方便快取/除錯 */
function apiGet(action, params){
    const url = new URL(CONFIG.API_URL);
    url.searchParams.set("action", action);
    Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
    return fetch(url.toString())
        .then(res => res.json())
        .then(json => {
            if (json && json.error) throw new Error(json.error);
            return json;
        });
}

/* 寫入類 API：用 POST，body 是 JSON 字串。
    Content-Type 刻意用 text/plain，避免瀏覽器送出 CORS 預檢請求（OPTIONS），
    因為 Apps Script 的 Web App 預設不處理 OPTIONS。 */
function apiPost(action, data){
    return fetch(CONFIG.API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, data })
    })
        .then(res => res.json())
        .then(json => {
            if (json && json.error) throw new Error(json.error);
            return json;
        });
}
