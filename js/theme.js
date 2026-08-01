/* =============================================================
   theme.js — 風格色調切換
   內容：THEMES、DEFAULT_THEME、setTheme()、initThemePicker()
============================================================= */

/* =============================== 風格色調切換 ================================ */
const THEMES = {
    sunset:   { label: "夕陽楓紅", color: "#e2492a" },
    ocean:    { label: "海洋藍調", color: "#2f6fbf" },
    forest:   { label: "森林抹茶", color: "#3f8556" },
    berry:    { label: "莓果粉紫", color: "#c23a72" },
    charcoal: { label: "質感灰調", color: "#4a4a52" }
};
const DEFAULT_THEME = "sunset";

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
    const currentTheme = document.documentElement.getAttribute("data-theme") || DEFAULT_THEME;
    document.querySelectorAll(".theme-swatch").forEach(function(btn){
        btn.classList.toggle("active", btn.dataset.theme === currentTheme);
    });
    const metaThemeColor = document.getElementById("themeColorMeta");
    if(metaThemeColor && THEMES[currentTheme]) metaThemeColor.setAttribute("content", THEMES[currentTheme].color);
}
