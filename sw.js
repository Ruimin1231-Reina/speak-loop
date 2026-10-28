/*
 * Speak Loop · sw.js
 * 离线缓存：没网时也能打开和复习。改了任何文件后，把 CACHE 的版本号 +1，用户下次打开就会更新。
 * 学习数据在 IndexedDB 里，不受缓存影响。
 */
const CACHE = 'speak-loop-v4';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './core.js',
  './prompts.js',
  './sample-pack.js',
  './storage.js',
  './speech.js',
  './sync.js',
  './ui.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('speak-loop-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // GitHub API 等外部请求不缓存

  if (req.mode === 'navigate') {
    // 页面：优先联网拿最新的，没网用缓存
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 静态文件：先用缓存，同时在后台更新
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
