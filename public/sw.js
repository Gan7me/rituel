/* Service worker — app shell en cache, fonctionnement hors ligne complet.
   Incrémente VERSION à chaque déploiement pour forcer la mise à jour. */
const VERSION = 'rituel-v3.20.2';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './muscles.js',
  './demo/index.json',
  './app.js',
  './program.json',
  './cycle.html',
  './manifest.webmanifest',
  './confidentialite.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
  './icons/logo-mask.png',
  './icons/mark-mask.png',
  './apple-touch-icon.png',
  './badges/s1.webp', './badges/s1_lock.webp',
  './badges/s10.webp', './badges/s10_lock.webp',
  './badges/s25.webp', './badges/s25_lock.webp',
  './badges/s50.webp', './badges/s50_lock.webp',
  './badges/s100.webp', './badges/s100_lock.webp',
  './badges/pr1.webp', './badges/pr1_lock.webp',
  './badges/pr5.webp', './badges/pr5_lock.webp',
  './badges/pr15.webp', './badges/pr15_lock.webp',
  './badges/t1.webp', './badges/t1_lock.webp',
  './badges/t45.webp', './badges/t45_lock.webp',
  './badges/t55.webp', './badges/t55_lock.webp',
  './badges/t70.webp', './badges/t70_lock.webp',
  './badges/w1.webp', './badges/w1_lock.webp',
  './badges/w4.webp', './badges/w4_lock.webp',
  './badges/w12.webp', './badges/w12_lock.webp',
  './badges/c1.webp', './badges/c1_lock.webp',
  './badges/ton.webp', './badges/ton_lock.webp',
  './badges/rank1.webp',
  './badges/rank2.webp',
  './badges/rank3.webp',
  './badges/rank4.webp',
  './badges/rank5.webp',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions-compat.js'
];

self.addEventListener('install', e => {
  // cache: 'reload' contourne le cache HTTP du navigateur, sinon on peut installer une version déjà périmée juste après un déploiement.
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => fetch(u, { cache: 'reload' }).then(r => { if (r.ok) return c.put(u, r); })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'rituel-demo').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Jamais de cache pour l'API GitHub (synchro) ni pour les requêtes hors origine.
  // Photos des mouvements (même origine, immuables) : cache dédié qui survit aux mises à jour, cache d'abord.
  if (url.origin === location.origin && url.pathname.includes('/demo/img/')) {
    e.respondWith(caches.open('rituel-demo').then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(res => { if (res && res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
  if (url.origin !== location.origin && !url.hostname.endsWith('gstatic.com')) return;
  // Cache d'abord pour le shell, réseau en secours puis mise à jour du cache (stale-while-revalidate).
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetched = fetch(e.request).then(res => {
        if (res && res.ok) caches.open(VERSION).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
