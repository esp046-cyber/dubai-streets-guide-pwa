/* Client-side static "API" over database/dubai-roads.json.
   Works in the browser (window.RoadsAPI), in a service worker, and in Node (require). */
(function (root) {
  'use strict';
  const CFG = (root.APP_CONFIG) || (typeof require !== 'undefined' ? safeRequire('../config/app.config.js') : null) || {};
  function safeRequire(p) { try { return require(p); } catch (e) { return null; } }

  const rad = (d) => (d * Math.PI) / 180;

  function distanceKm(lat1, lng1, lat2, lng2) {
    const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function bearing(lat1, lng1, lat2, lng2) {
    const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
    const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  /** Salik tariff for a moment in time, evaluated in Dubai time. */
  function salikTariff(date, cfg) {
    const s = (cfg || CFG).salik;
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: s.timeZone, hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(date || new Date());
    const hour = parseInt(parts.find((p) => p.type === 'hour').value, 10) % 24;
    const day = parts.find((p) => p.type === 'weekday').value; // Sun, Mon...
    if (hour >= s.freeWindow[0] && hour < s.freeWindow[1]) return { price: s.free, band: 'free', label: 'FREE' };
    if (day === 'Sun') return { price: s.sundayFlat, band: 'offpeak', label: 'AED ' + s.sundayFlat };
    const peak = s.peakWindows.some((w) => hour >= w[0] && hour < w[1]);
    return peak ? { price: s.peak, band: 'peak', label: 'AED ' + s.peak } : { price: s.offPeak, band: 'offpeak', label: 'AED ' + s.offPeak };
  }

  /** Lane states for one destination. Lane 1 = leftmost. */
  function laneState(lanes, destIdx) {
    const d = lanes.dest[destIdx || 0];
    const heldSet = new Set(d.hold);
    const out = [];
    for (let n = 1; n <= lanes.total; n++) {
      if (heldSet.has(n)) out.push({ n, state: 'go', label: 'KEEP' });
      else out.push({ n, state: 'wrong', label: d.kind === 'exit' ? 'THROUGH TRAFFIC' : 'EXIT ONLY' });
    }
    const avg = d.hold.reduce((a, b) => a + b, 0) / d.hold.length;
    const mid = (lanes.total + 1) / 2;
    const keep = avg < mid - 0.4 ? 'LEFT' : avg > mid + 0.4 ? 'RIGHT' : 'CENTRE';
    return { dest: d, lanes: out, keep };
  }

  function createAPI(db) {
    const cats = ['exit', 'gate', 'ra', 'gas', 'uturn', 'salik', 'split', 'hub', 'metro'];
    const all = [];
    cats.forEach((c) => (db[c] || []).forEach((it) => all.push(Object.assign({ cat: c }, it))));
    const byId = new Map(all.map((i) => [i.id, i]));
    return {
      db, all, byId,
      getHighways() { return db.roads.slice(); },
      getItem(id) { return byId.get(id) || null; },
      getNearestGas(lat, lng, opts) {
        opts = opts || {};
        return all.filter((i) => i.cat === 'gas')
          .filter((g) => (!opts.ev || g.ev) && (!opts.truck || g.truck) && (!opts.h24 || g.h24) && (!opts.prayer || g.prayer))
          .map((g) => Object.assign({ distKm: distanceKm(lat, lng, g.lat, g.lng) }, g))
          .sort((a, b) => a.distKm - b.distKm).slice(0, opts.limit || 5);
      },
      getUTurnsByZone(zone) { return all.filter((i) => i.cat === 'uturn' && (!zone || i.zone === zone)); },
      getLaneGuidance(id, destIdx) {
        const it = byId.get(id);
        if (!it || !it.lanes) return null;
        return Object.assign({ id, name: it.name }, laneState(it.lanes, destIdx));
      },
      nearestRoad(lat, lng) {
        let best = null;
        db.roads.forEach((r) => r.coords.forEach((c) => {
          const d = distanceKm(lat, lng, c[0], c[1]);
          if (!best || d < best.distKm) best = { road: r, distKm: d };
        }));
        return best;
      },
      search(q) {
        q = (q || '').trim().toLowerCase();
        if (!q) return [];
        return all.filter((i) => [i.name, i.ar, i.exit && ('exit ' + i.exit), i.road, i.brand, i.zone].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 12);
      }
    };
  }

  const RoadsAPI = {
    distanceKm, bearing, salikTariff, laneState, create: createAPI,
    async load(url) { const r = await fetch(url || 'database/dubai-roads.json'); if (!r.ok) throw new Error('DB ' + r.status); return createAPI(await r.json()); }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = RoadsAPI;
  root.RoadsAPI = RoadsAPI;
})(typeof self !== 'undefined' ? self : this);
