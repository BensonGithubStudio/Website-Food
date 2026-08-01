/* =============================================================
   utils.js — 共用小工具函式
   內容：formatDateTime()、escapeHtml()、showToast()
   說明：被多個模組共用，故獨立出來
============================================================= */

/* =============================== 時間格式化 ================================ */
// 把 ISO 時間字串轉成「YYYY/MM/DD HH:mm」的顯示格式
function formatDateTime(value){
    if(!value) return "";
    const d = new Date(value);
    if(isNaN(d.getTime())) return "";
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHtml(str){
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

/* =============================== Toast ================================ */
let toastTimer;
function showToast(message){
    const toast = document.getElementById("toast");
    toast.innerText = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>{
        toast.classList.remove("show");
    },2500);
}