/* Offline-first service worker */
importScripts('config/app.config.js', 'api/roads-api.js');

const VERSION = 'dsg-v1.0.0';
const CORE = `${VERSION}-core`, TILES = `${VERSION}-tiles`, TILE_MAX = 400;
const PRECACHE = [
  './', 'index.html', 'style.css', 'script.js', 'manifest.json', 'offline.html',
  'favicon.ico', 'icon-192.png', 'icon-512.png', 'browserconfig.xml',
  'config/app.config.js', 'api/roads-api.js', 'api/github-pusher.js', 'database/dubai-roads.json',
  'assets/og-image.png', 'assets/gas.svg', 'assets/uturn.svg', 'assets/highway.svg', 'assets/lane-left.svg', 'assets/lane-right.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CORE).then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(name, max) {
  const c = await caches.open(name), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

// Offline REST-like routes: /api/highways, /api/gas?lat=&lng=, /api/uturns?zone=, /api/lanes?id=&dest=
async function handleApi(url) {
  const dbRes = await (await caches.open(CORE)).match('database/dubai-roads.json') || await fetch('database/dubai-roads.json');
  const api = RoadsAPI.create(await dbRes.json());
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
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.includes('/api/') && !url.pathname.endsWith('.js')) { e.respondWith(handleApi(url)); return; }
  if (/tile\.openstreetmap\.org|basemaps\.cartocdn\.com/.test(url.hostname)) {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(req); if (hit) return hit;
      try { const r = await fetch(req); if (r.ok || r.type === 'opaque') { c.put(req, r.clone()); trim(TILES, TILE_MAX); } return r; }
      catch (err) { return new Response('', { status: 504 }); }
    }));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CORE).then((c) => c.put(req, copy)); return r; })
      .catch(() => caches.match(req).then((r) => r || caches.match('index.html')).then((r) => r || caches.match('offline.html'))));
    return;
  }
  // stale-while-revalidate for everything else
  e.respondWith(caches.open(CORE).then(async (c) => {
    const hit = await c.match(req);
    const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit || caches.match('offline.html'));
    return hit || net;
  }));
});
