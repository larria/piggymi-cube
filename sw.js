/**
 * sw.js — Service Worker
 *
 * 策略：预缓存核心资源（App Shell），安装后即可完全离线运行；
 * 运行时对页面与静态资源采用 cache-first + 后台更新（stale-while-revalidate），
 * 激活时清理旧版本缓存。
 */

const CACHE_NAME = 'cfop-cube-v1';

/** 核心资源（App Shell + 全部依赖，约 1.2MB） */
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/main.js',
  './js/core/cube.js',
  './js/core/cfop.js',
  './js/view/scene.js',
  './js/view/interaction.js',
  './lib/three.module.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

/** 安装：预缓存 */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

/** 激活：清理旧缓存 */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/** 请求：cache-first，后台静默更新（非关键资源容错） */
self.addEventListener('fetch', event => {
  const req = event.request;
  // 只处理同源 GET
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      const fetchPromise = fetch(req).then(res => {
        // 仅缓存成功响应
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return res;
      }).catch(() => cached);   // 离线且无缓存时兜底
      // 有缓存先用缓存，同时后台更新（SWR）
      return cached || fetchPromise;
    })
  );
});
