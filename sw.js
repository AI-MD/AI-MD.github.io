/* 주락 酒樂 서비스워커 — 오프라인 지원 + "새 배포·최신 데이터 항상 우선" 전략
   - HTML(내비게이션): network-first (새 index.html 즉시 반영, 오프라인이면 캐시→offline)
   - 데이터 JSON: network-first + 캐시 폴백
   - 정적 자산(아이콘·manifest 등 동일출처 GET): cache-first + 백그라운드 갱신
   - 교차출처/POST/Supabase 등: SW가 관여하지 않음(그대로 네트워크)  */
const CACHE = "jurak-v1";
const APP_SHELL = ["/offline.html", "/manifest.json", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];
const DATA_FILES = ["/data.json", "/colkage.json", "/dailyshot_top.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // HTML 내비게이션이면 오프라인 안내
    if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
      const off = await cache.match("/offline.html");
      if (off) return off;
    }
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) {
    // 백그라운드 갱신(실패 무시)
    fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); }).catch(() => {});
    return cached;
  }
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 동일출처 GET만 처리. 그 외(교차출처: supabase/unpkg/jsdelivr/kakao/ntfy/abacus…, 모든 POST 등)는 패스.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  const isHTML = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  const isData = DATA_FILES.includes(url.pathname) || url.pathname.endsWith(".json");

  if (isHTML || isData) {
    event.respondWith(networkFirst(req).catch(() => caches.match("/offline.html")));
  } else {
    event.respondWith(cacheFirst(req).catch(() => fetch(req).catch(() => caches.match(req))));
  }
});
