/* =============================================================
   state.js — 全域共用狀態
   內容：allFoodData、favoriteNames、showFavoritesOnly、editingRowNum
============================================================= */

let allFoodData = [];
let favoriteNames = new Set();
let showFavoritesOnly = false;
let editingRowNum = null; // null代表目前是「新增」模式，有值代表正在編輯該列資料
let foodListLoaded = false; // loadFood() 是否已經成功拿到過真正的資料，用來避免其他背景請求（例如 loadFavorites）在資料還沒到之前就搶先用空陣列渲染畫面
let sortBy = "updatedDesc"; // 目前的排序依據，對應 index.html 排序下拉選單的 option value，見 filters.js 的 SORT_OPTIONS
