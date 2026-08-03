const CACHE = 'tasasve-v1';
const STATIC = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // API calls: always network
  if (url.hostname.includes('dolarapi') || url.hostname.includes('criptoya') || url.hostname.includes('bcv.today') || url.hostname.includes('jsdelivr')) {
    e.respondWith(fetch(e.request).catch(() => new Response('{"error":"offline"}', { headers: { 'Content-Type': 'application/json' }})));
    return;
  }
  // Static: cache first
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
