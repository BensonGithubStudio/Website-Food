/* =============================================================
   state.js — 全域共用狀態
   內容：allFoodData、favoriteNames、showFavoritesOnly、editingRowNum
============================================================= */

let allFoodData = [];
let favoriteNames = new Set();
let showFavoritesOnly = false;
let editingRowNum = null; // null代表目前是「新增」模式，有值代表正在編輯該列資料
