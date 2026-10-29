/* Techno Bundle v10 — service worker.
 * Versioned cache; all URLs are resolved against the SW scope so GitHub Pages sub-paths work.
 * Bump CACHE_VERSION whenever any precached file changes. */
'use strict';

const CACHE_VERSION = 'v10.0.3';
// The cache name carries the SW scope path, so two deployments on one origin
// (e.g. user.github.io/app-a/ and user.github.io/app-b/) never delete each other's caches.
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const CACHE_PREFIX = 'techno-bundle-';
const CACHE_SUFFIX = '@' + SCOPE_PATH;
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION + CACHE_SUFFIX;

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/core.js',
  './js/app.js',
  './assets/logo.png',
  './assets/Yekan.ttf',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-48.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(PRECACHE.map((p) => new Request(new URL(p, self.registration.scope), { cache: 'reload' })))
    )
  );
  // No automatic skipWaiting: the page offers an explicit "update" action.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k.endsWith(CACHE_SUFFIX) && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch third-party requests

  // Page navigations: serve the cached app shell (works offline, ignores ?query).
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match(new URL('./index.html', self.registration.scope).href)
        .then((hit) => hit || fetch(req))
        .catch(() => caches.match(new URL('./index.html', self.registration.scope).href))
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
