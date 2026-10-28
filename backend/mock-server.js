/* Optional local mock server: serves the static site and the same /api/* routes the service worker answers offline.
   Usage: node backend/mock-server.js   (PORT env var optional, default 8080) */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
global.APP_CONFIG = require('../config/app.config.js');
const API = require('../api/roads-api.js');
const api = API.create(JSON.parse(fs.readFileSync(path.join(ROOT, 'database/dubai-roads.json'), 'utf8')));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain', '.md': 'text/markdown' };

function route(u) {
  const p = u.searchParams;
  switch (u.pathname) {
    case '/api/highways': return api.getHighways();
    case '/api/gas': return api.getNearestGas(+p.get('lat') || 25.0069, +p.get('lng') || 55.0867, { limit: +p.get('limit') || 5, ev: p.get('ev') === '1', truck: p.get('truck') === '1', h24: p.get('h24') === '1', prayer: p.get('prayer') === '1' });
    case '/api/uturns': return api.getUTurnsByZone(p.get('zone'));
    case '/api/lanes': return api.getLaneGuidance(p.get('id'), +p.get('dest') || 0);
    case '/api/salik': return API.salikTariff(new Date());
    default: return null;
  }
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname.startsWith('/api/') && !u.pathname.endsWith('.js')) {
    const body = route(u);
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(body || { error: 'not found' }));
  }
  let f = path.normalize(path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname)));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(process.env.PORT || 8080, () => console.log('Dubai Streets Guide on http://localhost:' + (process.env.PORT || 8080)));
