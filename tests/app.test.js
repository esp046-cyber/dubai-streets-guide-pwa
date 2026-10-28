/* Unit tests — run in the browser (tests/test-runner.html) or in Node: `node tests/app.test.js` */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  const CFG = isNode ? require('../config/app.config.js') : root.APP_CONFIG;
  if (isNode) root.APP_CONFIG = CFG;
  const API = isNode ? require('../api/roads-api.js') : root.RoadsAPI;
  const results = [];
  function test(name, fn) { try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: e.message }); } }
  function eq(a, b, m) { if (a !== b) throw new Error((m || 'expected') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
  function truthy(v, m) { if (!v) throw new Error(m || 'expected truthy'); }

  function run(db) {
    const api = API.create(db);
    // Salik tariff: build instants from Dubai local time (UTC+4)
    const at = (y, m, d, h) => new Date(Date.UTC(y, m - 1, d, h - 4));
    test('Salik peak weekday 07:00 = AED 6', () => eq(API.salikTariff(at(2026, 10, 28, 7)).price, 6)); // Wed
    test('Salik peak weekday 17:00 = AED 6', () => eq(API.salikTariff(at(2026, 10, 28, 17)).price, 6));
    test('Salik off-peak weekday 12:00 = AED 4', () => eq(API.salikTariff(at(2026, 10, 28, 12)).price, 4));
    test('Salik off-peak weekday 22:00 = AED 4', () => eq(API.salikTariff(at(2026, 10, 28, 22)).price, 4));
    test('Salik free 03:00', () => { const t = API.salikTariff(at(2026, 10, 28, 3)); eq(t.price, 0); eq(t.band, 'free'); });
    test('Salik Sunday 08:00 = AED 4', () => eq(API.salikTariff(at(2026, 11, 1, 8)).price, 4)); // Sun
    test('Salik evaluates in Dubai time, not UTC', () => eq(API.salikTariff(new Date(Date.UTC(2026, 9, 28, 3, 0))).price, 6)); // 07:00 Dubai
    test('distanceKm ≈ 111 km per degree latitude', () => truthy(Math.abs(API.distanceKm(25, 55, 26, 55) - 111.2) < 0.5));
    test('database has all categories', () => ['roads', 'exit', 'split', 'uturn', 'gas', 'gate', 'ra', 'hub', 'metro', 'salik', 'zones', 'routes'].forEach((k) => truthy(db[k] && db[k].length, k)));
    test('12 JAFZA gates and 15 roundabouts', () => { eq(db.gate.length, 12); eq(db.ra.length, 15); });
    test('all required highways present', () => ['e11', 'e311', 'e611', 'e77', 'd53', 'd57', 'd59', 'd63', 'd54', 'e44', 'e66'].forEach((id) => truthy(db.roads.find((r) => r.id === id), id)));
    test('ids are unique', () => eq(new Set(api.all.map((i) => i.id)).size, api.all.length));
    test('every lane hold is within lane count', () => api.all.filter((i) => i.lanes).forEach((i) => i.lanes.dest.forEach((d) => d.hold.forEach((n) => truthy(n >= 1 && n <= i.lanes.total, i.id)))));
    test('lane state: exit dest marks others THROUGH TRAFFIC', () => { const g = api.getLaneGuidance('x20', 0); eq(g.lanes.filter((l) => l.state === 'go').length, 2); eq(g.lanes[0].label, 'THROUGH TRAFFIC'); eq(g.keep, 'RIGHT'); });
    test('lane state: through dest marks others EXIT ONLY', () => { const g = api.getLaneGuidance('x20', 1); eq(g.lanes[5].label, 'EXIT ONLY'); eq(g.keep, 'LEFT'); });
    test('every recovery points to a real U-turn', () => api.all.filter((i) => i.recovery).forEach((i) => truthy(api.getItem(i.recovery.uturn), i.id)));
    test('route steps reference real items', () => db.routes.forEach((r) => r.steps.forEach((s) => { if (s.item) truthy(api.getItem(s.item), s.item); truthy(typeof s.lat === 'number', r.id); })));
    test('getNearestGas returns sorted results', () => { const g = api.getNearestGas(25.0069, 55.0867, { limit: 5 }); eq(g.length, 5); for (let i = 1; i < g.length; i++) truthy(g[i].distKm >= g[i - 1].distKm); });
    test('getNearestGas EV filter', () => api.getNearestGas(25, 55.08, { ev: true, limit: 20 }).forEach((g) => truthy(g.ev)));
    test('getUTurnsByZone filters by zone', () => { const u = api.getUTurnsByZone('jafza'); truthy(u.length >= 2); u.forEach((x) => eq(x.zone, 'jafza')); });
    test('search finds exit by number', () => truthy(api.search('exit 25').some((i) => i.id === 'x25')));
    test('every projectFiles path is a string', () => CFG.projectFiles.forEach((p) => eq(typeof p, 'string')));
    return results;
  }

  function render(rs) {
    const pass = rs.filter((r) => r.ok).length;
    if (isNode) {
      rs.forEach((r) => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.err ? ' — ' + r.err : '')));
      console.log(`\n${pass}/${rs.length} passed`);
      process.exitCode = pass === rs.length ? 0 : 1;
    } else {
      const el = document.getElementById('out');
      el.innerHTML = `<h2 class="${pass === rs.length ? 'ok' : 'bad'}">${pass}/${rs.length} passed</h2>` + rs.map((r) => `<div class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'} ${r.name}${r.err ? ' — ' + r.err : ''}</div>`).join('');
    }
  }

  if (isNode) render(run(JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../database/dubai-roads.json'), 'utf8'))));
  else fetch('../database/dubai-roads.json').then((r) => r.json()).then((db) => render(run(db))).catch((e) => { document.getElementById('out').textContent = 'Could not load the database: ' + e.message + '. Serve the folder over http(s) (GitHub Pages works).'; });
})(typeof self !== 'undefined' ? self : this);
