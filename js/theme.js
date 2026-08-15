/* =============================================================
   theme.js — 風格色調切換
   內容：THEMES、DEFAULT_THEME、setTheme()、initThemePicker()
============================================================= */

/* =============================== 風格色調切換 ================================ */
/* 色彩依色相環排序（暖 → 冷 → 中性色），數值經過調整以拉開彼此的對比，
   避免相鄰主題色太過相近而讓使用者分不清楚 */
const THEMES = {
    rouge:    { label: "胭脂紅豔", color: "#d7263d" },
    sunset:   { label: "夕陽楓紅", color: "#f2762e" },
    honey:    { label: "蜂蜜黃調", color: "#f0a91b" },
    forest:   { label: "森林抹茶", color: "#2f8f5b" },
    ocean:    { label: "海洋藍調", color: "#2f6fbf" },
    lavender: { label: "薰衣草紫", color: "#8256c9" },
    berry:    { label: "莓果粉紫", color: "#c23a72" },
    cloud:    { label: "雲朵奶霜", color: "#94a3b8" },
    charcoal: { label: "質感灰調", color: "#4a4a52" },
    night:    { label: "夜幕黑調", color: "#15141a" }
};
const DEFAULT_THEME = "sunset";

// 讓色票按鈕的背景色，直接取自 THEMES 裡的顏色，
// 確保「按鈕看起來的顏色」永遠等於「實際套用的主題色」，不會再對不上
function syncSwatchColors(){
    document.querySelectorAll(".theme-swatch").forEach(function(btn){
        const theme = THEMES[btn.dataset.theme];
        if(theme) btn.style.backgroundColor = theme.color;
    });
}

function setTheme(themeName){
    if(!THEMES[themeName]) themeName = DEFAULT_THEME;

    document.documentElement.setAttribute("data-theme", themeName);

    // 更新手機瀏覽器網址列/工作列的主題色，跟畫面主色保持一致
    const metaThemeColor = document.getElementById("themeColorMeta");
    if(metaThemeColor) metaThemeColor.setAttribute("content", THEMES[themeName].color);

    // 記住這次選擇，下次造訪自動套用
    try {
        localStorage.setItem("foodAppTheme", themeName);
    } catch(e){ /* 無痕模式或瀏覽器封鎖 localStorage 時，安靜地忽略，這次選擇就只在當前分頁生效 */ }

    // 同步畫面上色票的選中狀態
    document.querySelectorAll(".theme-swatch").forEach(function(btn){
        btn.classList.toggle("active", btn.dataset.theme === themeName);
    });

    showToast("🎨 已套用「" + THEMES[themeName].label + "」風格");
}

// 頁面載入時，把畫面上的色票狀態同步成目前生效中的主題（不彈提示、不重複寫入 localStorage）
function initThemePicker(){
    syncSwatchColors();

    const currentTheme = document.documentElement.getAttribute("data-theme") || DEFAULT_THEME;
    document.querySelectorAll(".theme-swatch").forEach(function(btn){
        btn.classList.toggle("active", btn.dataset.theme === currentTheme);
    });
    const metaThemeColor = document.getElementById("themeColorMeta");
    if(metaThemeColor && THEMES[currentTheme]) metaThemeColor.setAttribute("content", THEMES[currentTheme].color);
}
