const CACHE_NAME = 'sni-gantt-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 네트워크 우선 전략 (Supabase 실시간 동기화 유지)
self.addEventListener('fetch', (event) => {
  // Supabase API 요청은 캐시 안 함
  if (event.request.url.includes('supabase.co')) return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
