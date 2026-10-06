/* Service worker — app shell en cache, fonctionnement hors ligne complet.
   Incrémente VERSION à chaque déploiement pour forcer la mise à jour. */
const VERSION = 'rituel-v3.13.4';
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
  // Photos de démonstration : cache dédié, servies hors ligne une fois vues.
  if (url.hostname === 'raw.githubusercontent.com') {
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
