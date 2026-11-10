// 오프라인 실행용: 설치할 때 첫 화면과 거기 걸린 파일(JS·CSS·아이콘)을 미리 받아 두고,
// 그 뒤로는 받은 파일을 캐시해 두었다가 네트워크가 없으면 캐시로 응답
const CACHE = 'table-war-v3';

// 첫 화면(index.html)을 받아 거기 적힌 ./ 경로 파일을 모두 캐시 — 한 번만 열어도 오프라인에서 열리게
async function precache() {
  const c = await caches.open(CACHE);
  const res = await fetch('./', { cache: 'reload' });
  if (!res.ok) return;
  const html = await res.clone().text();
  await c.put('./', res);
  const urls = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1]);
  await Promise.all(urls.map((u) => fetch(u, { cache: 'reload' }).then((r) => r.ok && c.put(u, r)).catch(() => {})));
}

self.addEventListener('install', (e) => e.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))); // 옛 캐시 지움
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./'))),
  );
});
