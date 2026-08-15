// ====================== 美食口袋名單 Service Worker ======================
// 用途：讓網站符合 PWA 安裝條件，並提供基本的離線快取能力。
// 部署位置：需放在網站根目錄（跟 index.html 同一層），
// 這樣它的控制範圍（scope）才能涵蓋整個網站。

const CACHE_NAME = "food-app-v1"; // 之後若更新快取內容，記得把版本號改掉（v1 -> v2），才能讓舊快取失效

// 開站就先快取起來的「殼」資源：就算離線，至少能看到頁面骨架
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./logo.png",
  "./favicon-32x32.png",
  "./favicon-16x16.png",
  "./favicon.ico",
  "./apple-touch-icon.png",
  "./android-icon-192.png",
  "./android-icon-512.png",
  "./js/api.js",
  "./js/state.js",
  "./js/utils.js",
  "./js/theme.js",
  "./js/filters.js",
  "./js/cursor-effects.js",
  "./js/favorites.js",
  "./js/food-crud.js",
  "./js/corner-glow.js",
  "./js/map.js",
  "./js/share.js",
  "./js/mobile-nav.js",
  "./js/introAnimation.js",
  "./js/entranceAnimation.js",
  "./js/main.js"
];

// 安裝階段：把上面列的檔案都抓下來放進快取
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // 用 addAll 時，只要有一個檔案 404，整個安裝就會失敗，
      // 所以這裡改用逐一 add、單一失敗不影響其他檔案
      return Promise.all(
        ASSETS_TO_CACHE.map((url) =>
          cache.add(url).catch((err) => {
            console.warn("[sw] 快取失敗，略過：", url, err);
          })
        )
      );
    })
  );
  self.skipWaiting(); // 不等舊的 service worker 離線，直接讓新版本上線
});

// 啟用階段：清掉舊版本快取，避免越堆越多
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim(); // 讓目前已開啟的分頁立刻改由新 service worker 接管
});

// 攔截網路請求：
// 策略是「網路優先，失敗才用快取」，這樣平常上線時資料還是即時的，
// 只有離線或連線失敗時才 fallback 回快取內容。
self.addEventListener("fetch", (event) => {
  // 只處理 GET 請求，避免把 API 的 POST/PUT/DELETE 也快取住
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 順手把成功抓到的頁面資源更新進快取
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
