/* =============================== 初始化 ================================ */
window.onload = function(){
    loadFood(); // 內含店家清單 + 我的最愛，兩者都拿到才會一起渲染畫面
    loadTypeOptions();
    initSmokeCursor();
    initThemePicker();
    initStickyForm();
};
