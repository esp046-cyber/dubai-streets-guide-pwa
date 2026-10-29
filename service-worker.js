/* Offline fallback service worker — GitHub Pages sub-path safe (relative paths only).
   Never touches cross-origin requests (map tiles, Leaflet CDN, fonts), so it cannot blank the map. */
try { importScripts('./config/app.config.js', './api/roads-api.js'); } catch (e) { /* flat upload: offline API routes disabled */ }

const VERSION = 'dubai-streets-v3';   // keep in sync with CACHE in index.html
const PRECACHE = ['./', './index.html', './style.css', './script.js', './manifest.json', './offline.html', './favicon.ico', './icon-192.png', './icon-512.png', './og-image.png', './dubai-roads.json', './database/dubai-roads.json'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(PRECACHE.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null)))));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Offline REST-like routes (/api/highways, /api/gas, /api/uturns, /api/lanes) when the API helper is present.
async function handleApi(url) {
  const cache = await caches.open(VERSION);
  const dbRes = (await cache.match('./database/dubai-roads.json')) || (await cache.match('./dubai-roads.json')) || (await fetch('./dubai-roads.json'));
  const api = self.RoadsAPI.create(await dbRes.json());
  const p = url.searchParams, path = url.pathname.split('/api/')[1];
  let body;
  if (path === 'highways') body = api.getHighways();
  else if (path === 'gas') body = api.getNearestGas(+p.get('lat') || 25.0069, +p.get('lng') || 55.0867, { limit: +p.get('limit') || 5, ev: p.get('ev') === '1', truck: p.get('truck') === '1', h24: p.get('h24') === '1', prayer: p.get('prayer') === '1' });
  else if (path === 'uturns') body = api.getUTurnsByZone(p.get('zone'));
  else if (path === 'lanes') body = api.getLaneGuidance(p.get('id'), +p.get('dest') || 0);
  else return new Response('{"error":"not found"}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;   // bypass tiles, CDNs, fonts
  if (self.RoadsAPI && url.pathname.includes('/api/') && !url.pathname.endsWith('.js')) { e.respondWith(handleApi(url)); return; }
  // Network first (always fresh), cache as offline fallback.
  e.respondWith(fetch(req).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return r;
  }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html').then((h) => h || caches.match('./offline.html')) : Response.error()))));
});
