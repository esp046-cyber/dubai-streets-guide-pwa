/* Dubai Streets Guide PRO — single-file bundle: config + API + GitHub pusher + built-in database + app.
   Works with a flat upload (only root files) or the full folder layout. Sources: config/, api/. */

/* ===== config/app.config.js ===== */
/* Dubai Streets Guide — app configuration */
(function (root) {
  'use strict';
  const config = {
    version: '1.0.0',
    center: [25.0069, 55.0867], // Jebel Ali
    zoom: { default: 12, city: 11, street: 15, detail: 17 },
    // Keyless CARTO Voyager raster tiles (no API key, no watermark). Night mode inverts them with a CSS filter (.tiles-night).
    tiles: {
      day:   { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attr: '&copy; OpenStreetMap contributors &copy; CARTO' },
      night: { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attr: '&copy; OpenStreetMap contributors &copy; CARTO', cls: 'tiles-night' },
      fallback: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attr: '&copy; OpenStreetMap contributors' }
    },
    // Dubai radar: widely reported ~20 km/h flash tolerance. Informational only: the posted limit is the law.
    radarBuffer: { dubai: 20, abuDhabi: 0, note: 'Informational only. The posted limit is the legal limit.' },
    // Approximate Dubai / Abu Dhabi emirate border on the coast road (longitude west of this = Abu Dhabi).
    borderLng: 54.97,
    defaultLimit: 80,
    // Salik variable tariff (Dubai time, from 31 Jan 2025). Verify at salik.ae.
    salik: {
      timeZone: 'Asia/Dubai',
      peak: 6, offPeak: 4, free: 0,
      peakWindows: [[6, 10], [16, 20]],          // Mon–Sat
      offPeakWindows: [[10, 16], [20, 25]],      // Mon–Sat (25 = 01:00 next day)
      freeWindow: [1, 6],                        // every day
      sundayFlat: 4                              // Sunday: AED 4 outside the free window
    },
    // Monthly UAE fuel prices (AED / litre). Source: UAE Fuel Price Committee, October 2026.
    // Edit here each month — new prices are announced on the last day of the month.
    fuel: { asOf: 'October 2026', super98: 4.40, special95: 4.28, eplus91: 4.21, diesel: 4.80 },
    // Indicative only — RTA publishes the official truck movement bans.
    truck: { windows: [['06:00', '08:00'], ['17:00', '20:00']], note: 'Indicative. Check the current RTA truck-ban notice.' },
    themes: {
      night: { bg: '#0b1210', accent: '#10b981', warn: '#f59e0b' },
      day:   { bg: '#f4ead2', accent: '#047857', warn: '#b45309' }
    },
    roadColors: { highway: '#10b981', slip: '#06b6d4', flyover: '#f59e0b', loop: '#a855f7' },
    gantry: { green: '#006B3F', blue: '#00529B' },
    // Files the in-app GitHub pusher uploads (paths relative to the site root)
    projectFiles: [
      'index.html', 'style.css', 'dubai-roads.json', 'og-image.png', 'screenshot-map.png', 'screenshot-lanes.png', 'script.js', 'manifest.json', 'service-worker.js', 'offline.html',
      'favicon.ico', 'icon-192.png', 'icon-512.png', 'README.md', '.gitignore', 'package.json',
      '.env.example', 'LICENSE', 'robots.txt', 'sitemap.xml', 'browserconfig.xml',
      'assets/og-image.png', 'assets/gas.svg', 'assets/uturn.svg', 'assets/highway.svg', 'assets/lane-left.svg', 'assets/lane-right.svg',
      'screenshots/mobile-map.png', 'screenshots/lane-guide.png',
      'tests/app.test.js', 'tests/test-runner.html',
      'docs/ARCHITECTURE.md', 'docs/JEBEL_ALI_ROAD_MANUAL.md', 'docs/iphone-github-uploader.html',
      'api/roads-api.js', 'api/github-pusher.js',
      'backend/mock-server.js', 'backend/README.md',
      'database/dubai-roads.json', 'database/schema.json',
      'config/app.config.js'
    ]
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = config;
  root.APP_CONFIG = config;
})(typeof self !== 'undefined' ? self : this);

/* ===== api/roads-api.js ===== */
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

/* ===== api/github-pusher.js ===== */
/* GitHub Contents API pusher — runs entirely in the browser (iPhone Safari friendly). */
(function (root) {
  'use strict';

  function toBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  async function gh(token, method, path, body) {
    const res = await fetch('https://api.github.com' + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* empty body */ }
    return { ok: res.ok, status: res.status, json };
  }

  /** files: [{path, content: ArrayBuffer}] */
  async function pushFiles(opts, files, log) {
    const { user, repo, branch, token } = opts;
    if (!user || !repo || !token) throw new Error('Username, repository and token are required.');
    log = log || function () {};
    const repoInfo = await gh(token, 'GET', `/repos/${user}/${repo}`);
    if (!repoInfo.ok) throw new Error(`Cannot open ${user}/${repo} (HTTP ${repoInfo.status}). Create the repository first and check the token scope.`);
    let done = 0, failed = 0;
    for (const f of files) {
      const path = '/repos/' + user + '/' + repo + '/contents/' + f.path.split('/').map(encodeURIComponent).join('/');
      const existing = await gh(token, 'GET', path + '?ref=' + encodeURIComponent(branch));
      const body = { message: 'Add ' + f.path, content: toBase64(f.content), branch };
      if (existing.ok && existing.json && existing.json.sha) body.sha = existing.json.sha;
      const r = await gh(token, 'PUT', path, body);
      if (r.ok) { done++; log(`✓ ${f.path} (${done}/${files.length})`); }
      else { failed++; log(`✗ ${f.path} — HTTP ${r.status} ${(r.json && r.json.message) || ''}`); }
    }
    log(`Finished: ${done} uploaded, ${failed} failed.`);
    if (!failed) log(`Next: repo Settings → Pages → Branch ${branch} / root → Save.\nSite: https://${user}.github.io/${repo}/`);
    return { done, failed };
  }

  /** Reads the project's own files from the site it is served from, using the manifest list in APP_CONFIG. */
  async function pushSiteFiles(opts, log) {
    const list = (root.APP_CONFIG && root.APP_CONFIG.projectFiles) || [];
    const files = [];
    for (const p of list) {
      try {
        const r = await fetch(p, { cache: 'no-store' });
        if (!r.ok) throw new Error(r.status);
        files.push({ path: p, content: await r.arrayBuffer() });
      } catch (e) { (log || function () {})('skip ' + p + ' (not reachable: ' + e.message + ')'); }
    }
    return pushFiles(opts, files, log);
  }

  root.GitHubPusher = { pushFiles, pushSiteFiles, toBase64 };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.GitHubPusher;
})(typeof self !== 'undefined' ? self : this);

/* ===== built-in database (fallback) ===== */
window.BUILTIN_DUBAI_DB = {"meta":{"name":"Dubai Streets Guide road database","version":"1.0.0","generated":"2026-10-29","coordinateSystem":"WGS84","caveat":"Coordinates are approximate/schematic and exit numbers, gate numbers and lane data are driving aids, not an official source. Verify on the road and with RTA/JAFZA/ADNOC/ENOC/Emarat."},"roads":[{"id":"e11","name":"E11 Sheikh Zayed Road","ar":"شارع الشيخ زايد","type":"highway","limit":100,"coords":[[24.935,54.955],[24.93633,54.957],[24.93767,54.959],[24.939,54.961],[24.94033,54.963],[24.94167,54.965],[24.943,54.967],[24.94433,54.969],[24.94567,54.971],[24.947,54.973],[24.94833,54.975],[24.94967,54.977],[24.951,54.979],[24.95233,54.981],[24.95367,54.983],[24.955,54.985],[24.95633,54.987],[24.95767,54.989],[24.959,54.991],[24.96033,54.993],[24.96167,54.995],[24.963,54.997],[24.96433,54.999],[24.96567,55.001],[24.967,55.003],[24.96833,55.005],[24.96967,55.007],[24.971,55.009],[24.97233,55.011],[24.97367,55.013],[24.975,55.015],[24.97619,55.01714],[24.97738,55.01929],[24.97857,55.02143],[24.97976,55.02357],[24.98095,55.02571],[24.98214,55.02786],[24.98333,55.03],[24.98452,55.03214],[24.98571,55.03429],[24.9869,55.03643],[24.9881,55.03857],[24.98929,55.04071],[24.99048,55.04286],[24.99167,55.045],[24.99286,55.04714],[24.99405,55.04929],[24.99524,55.05143],[24.99643,55.05357],[24.99762,55.05571],[24.99881,55.05786],[25.0,55.06],[25.00125,55.06219],[25.0025,55.06437],[25.00375,55.06656],[25.005,55.06875],[25.00625,55.07094],[25.0075,55.07313],[25.00875,55.07531],[25.01,55.0775],[25.01125,55.07969],[25.0125,55.08187],[25.01375,55.08406],[25.015,55.08625],[25.01625,55.08844],[25.0175,55.09063],[25.01875,55.09281],[25.02,55.095],[25.02167,55.09667],[25.02333,55.09833],[25.025,55.1],[25.02667,55.10167],[25.02833,55.10333],[25.03,55.105],[25.03167,55.10667],[25.03333,55.10833],[25.035,55.11],[25.03667,55.11167],[25.03833,55.11333],[25.04,55.115],[25.04167,55.11667],[25.04333,55.11833],[25.045,55.12],[25.04688,55.12156],[25.04875,55.12313],[25.05063,55.12469],[25.0525,55.12625],[25.05438,55.12781],[25.05625,55.12937],[25.05813,55.13094],[25.06,55.1325],[25.06188,55.13406],[25.06375,55.13563],[25.06563,55.13719],[25.0675,55.13875],[25.06938,55.14031],[25.07125,55.14187],[25.07313,55.14344],[25.075,55.145],[25.07658,55.14684],[25.07816,55.14868],[25.07974,55.15053],[25.08132,55.15237],[25.08289,55.15421],[25.08447,55.15605],[25.08605,55.15789],[25.08763,55.15974],[25.08921,55.16158],[25.09079,55.16342],[25.09237,55.16526],[25.09395,55.16711],[25.09553,55.16895],[25.09711,55.17079],[25.09868,55.17263],[25.10026,55.17447],[25.10184,55.17632],[25.10342,55.17816],[25.105,55.18],[25.10654,55.18192],[25.10808,55.18385],[25.10962,55.18577],[25.11115,55.18769],[25.11269,55.18962],[25.11423,55.19154],[25.11577,55.19346],[25.11731,55.19538],[25.11885,55.19731],[25.12038,55.19923],[25.12192,55.20115],[25.12346,55.20308],[25.125,55.205],[25.12674,55.20674],[25.12848,55.20848],[25.13022,55.21022],[25.13196,55.21196],[25.1337,55.2137],[25.13543,55.21543],[25.13717,55.21717],[25.13891,55.21891],[25.14065,55.22065],[25.14239,55.22239],[25.14413,55.22413],[25.14587,55.22587],[25.14761,55.22761],[25.14935,55.22935],[25.15109,55.23109],[25.15283,55.23283],[25.15457,55.23457],[25.1563,55.2363],[25.15804,55.23804],[25.15978,55.23978],[25.16152,55.24152],[25.16326,55.24326],[25.165,55.245],[25.16688,55.24659],[25.16876,55.24818],[25.17065,55.24976],[25.17253,55.25135],[25.17441,55.25294],[25.17629,55.25453],[25.17818,55.25612],[25.18006,55.25771],[25.18194,55.25929],[25.18382,55.26088],[25.18571,55.26247],[25.18759,55.26406],[25.18947,55.26565],[25.19135,55.26724],[25.19324,55.26882],[25.19512,55.27041],[25.197,55.272],[25.19903,55.27322],[25.20107,55.27443],[25.2031,55.27565],[25.20513,55.27687],[25.20717,55.27808],[25.2092,55.2793],[25.21123,55.28052],[25.21327,55.28173],[25.2153,55.28295],[25.21733,55.28417],[25.21937,55.28538],[25.2214,55.2866]],"note":"Jebel Ali border to Trade Centre. Limit varies 100–120."},{"id":"e311","name":"E311 Sheikh Mohammed Bin Zayed Rd","ar":"شارع الشيخ محمد بن زايد","type":"highway","limit":120,"coords":[[24.95,55.12],[24.95125,55.12214],[24.9525,55.12429],[24.95375,55.12643],[24.955,55.12857],[24.95625,55.13071],[24.9575,55.13286],[24.95875,55.135],[24.96,55.13714],[24.96125,55.13929],[24.9625,55.14143],[24.96375,55.14357],[24.965,55.14571],[24.96625,55.14786],[24.9675,55.15],[24.96875,55.15214],[24.97,55.15429],[24.97125,55.15643],[24.9725,55.15857],[24.97375,55.16071],[24.975,55.16286],[24.97625,55.165],[24.9775,55.16714],[24.97875,55.16929],[24.98,55.17143],[24.98125,55.17357],[24.9825,55.17571],[24.98375,55.17786],[24.985,55.18],[24.98632,55.18206],[24.98765,55.18412],[24.98897,55.18618],[24.99029,55.18824],[24.99162,55.19029],[24.99294,55.19235],[24.99426,55.19441],[24.99559,55.19647],[24.99691,55.19853],[24.99824,55.20059],[24.99956,55.20265],[25.00088,55.20471],[25.00221,55.20676],[25.00353,55.20882],[25.00485,55.21088],[25.00618,55.21294],[25.0075,55.215],[25.00882,55.21706],[25.01015,55.21912],[25.01147,55.22118],[25.01279,55.22324],[25.01412,55.22529],[25.01544,55.22735],[25.01676,55.22941],[25.01809,55.23147],[25.01941,55.23353],[25.02074,55.23559],[25.02206,55.23765],[25.02338,55.23971],[25.02471,55.24176],[25.02603,55.24382],[25.02735,55.24588],[25.02868,55.24794],[25.03,55.25],[25.03143,55.25196],[25.03286,55.25393],[25.03429,55.25589],[25.03571,55.25786],[25.03714,55.25982],[25.03857,55.26179],[25.04,55.26375],[25.04143,55.26571],[25.04286,55.26768],[25.04429,55.26964],[25.04571,55.27161],[25.04714,55.27357],[25.04857,55.27554],[25.05,55.2775],[25.05143,55.27946],[25.05286,55.28143],[25.05429,55.28339],[25.05571,55.28536],[25.05714,55.28732],[25.05857,55.28929],[25.06,55.29125],[25.06143,55.29321],[25.06286,55.29518],[25.06429,55.29714],[25.06571,55.29911],[25.06714,55.30107],[25.06857,55.30304],[25.07,55.305],[25.07161,55.30677],[25.07323,55.30855],[25.07484,55.31032],[25.07645,55.3121],[25.07806,55.31387],[25.07968,55.31565],[25.08129,55.31742],[25.0829,55.31919],[25.08452,55.32097],[25.08613,55.32274],[25.08774,55.32452],[25.08935,55.32629],[25.09097,55.32806],[25.09258,55.32984],[25.09419,55.33161],[25.09581,55.33339],[25.09742,55.33516],[25.09903,55.33694],[25.10065,55.33871],[25.10226,55.34048],[25.10387,55.34226],[25.10548,55.34403],[25.1071,55.34581],[25.10871,55.34758],[25.11032,55.34935],[25.11194,55.35113],[25.11355,55.3529],[25.11516,55.35468],[25.11677,55.35645],[25.11839,55.35823],[25.12,55.36],[25.12172,55.36172],[25.12345,55.36345],[25.12517,55.36517],[25.1269,55.3669],[25.12862,55.36862],[25.13034,55.37034],[25.13207,55.37207],[25.13379,55.37379],[25.13552,55.37552],[25.13724,55.37724],[25.13897,55.37897],[25.14069,55.38069],[25.14241,55.38241],[25.14414,55.38414],[25.14586,55.38586],[25.14759,55.38759],[25.14931,55.38931],[25.15103,55.39103],[25.15276,55.39276],[25.15448,55.39448],[25.15621,55.39621],[25.15793,55.39793],[25.15966,55.39966],[25.16138,55.40138],[25.1631,55.4031],[25.16483,55.40483],[25.16655,55.40655],[25.16828,55.40828],[25.17,55.41],[25.1715,55.412],[25.173,55.414],[25.1745,55.416],[25.176,55.418],[25.1775,55.42],[25.179,55.422],[25.1805,55.424],[25.182,55.426],[25.1835,55.428],[25.185,55.43],[25.1865,55.432],[25.188,55.434],[25.1895,55.436],[25.191,55.438],[25.1925,55.44],[25.194,55.442],[25.1955,55.444],[25.197,55.446],[25.1985,55.448],[25.2,55.45]],"note":"Heavy-truck lane rules apply."},{"id":"e611","name":"E611 Emirates Road","ar":"شارع الإمارات","type":"highway","limit":120,"coords":[[24.88,55.19],[24.88167,55.19167],[24.88333,55.19333],[24.885,55.195],[24.88667,55.19667],[24.88833,55.19833],[24.89,55.2],[24.89167,55.20167],[24.89333,55.20333],[24.895,55.205],[24.89667,55.20667],[24.89833,55.20833],[24.9,55.21],[24.90167,55.21167],[24.90333,55.21333],[24.905,55.215],[24.90667,55.21667],[24.90833,55.21833],[24.91,55.22],[24.91167,55.22167],[24.91333,55.22333],[24.915,55.225],[24.91667,55.22667],[24.91833,55.22833],[24.92,55.23],[24.92167,55.23167],[24.92333,55.23333],[24.925,55.235],[24.92667,55.23667],[24.92833,55.23833],[24.93,55.24],[24.93167,55.24167],[24.93333,55.24333],[24.935,55.245],[24.93667,55.24667],[24.93833,55.24833],[24.94,55.25],[24.94167,55.25167],[24.94333,55.25333],[24.945,55.255],[24.94667,55.25667],[24.94833,55.25833],[24.95,55.26],[24.95167,55.26167],[24.95333,55.26333],[24.955,55.265],[24.95667,55.26667],[24.95833,55.26833],[24.96,55.27],[24.96167,55.27167],[24.96333,55.27333],[24.965,55.275],[24.96667,55.27667],[24.96833,55.27833],[24.97,55.28],[24.97167,55.28167],[24.97333,55.28333],[24.975,55.285],[24.97667,55.28667],[24.97833,55.28833],[24.98,55.29],[24.98167,55.29167],[24.98333,55.29333],[24.985,55.295],[24.98667,55.29667],[24.98833,55.29833],[24.99,55.3],[24.99167,55.30167],[24.99333,55.30333],[24.995,55.305],[24.99667,55.30667],[24.99833,55.30833],[25.0,55.31],[25.00167,55.31167],[25.00333,55.31333],[25.005,55.315],[25.00667,55.31667],[25.00833,55.31833],[25.01,55.32],[25.01167,55.32167],[25.01333,55.32333],[25.015,55.325],[25.01667,55.32667],[25.01833,55.32833],[25.02,55.33],[25.02167,55.33167],[25.02333,55.33333],[25.025,55.335],[25.02667,55.33667],[25.02833,55.33833],[25.03,55.34],[25.03179,55.34154],[25.03359,55.34308],[25.03538,55.34462],[25.03718,55.34615],[25.03897,55.34769],[25.04077,55.34923],[25.04256,55.35077],[25.04436,55.35231],[25.04615,55.35385],[25.04795,55.35538],[25.04974,55.35692],[25.05154,55.35846],[25.05333,55.36],[25.05513,55.36154],[25.05692,55.36308],[25.05872,55.36462],[25.06051,55.36615],[25.06231,55.36769],[25.0641,55.36923],[25.0659,55.37077],[25.06769,55.37231],[25.06949,55.37385],[25.07128,55.37538],[25.07308,55.37692],[25.07487,55.37846],[25.07667,55.38],[25.07846,55.38154],[25.08026,55.38308],[25.08205,55.38462],[25.08385,55.38615],[25.08564,55.38769],[25.08744,55.38923],[25.08923,55.39077],[25.09103,55.39231],[25.09282,55.39385],[25.09462,55.39538],[25.09641,55.39692],[25.09821,55.39846],[25.1,55.4],[25.10156,55.40187],[25.10313,55.40375],[25.10469,55.40563],[25.10625,55.4075],[25.10781,55.40937],[25.10938,55.41125],[25.11094,55.41313],[25.1125,55.415],[25.11406,55.41687],[25.11563,55.41875],[25.11719,55.42063],[25.11875,55.4225],[25.12031,55.42437],[25.12187,55.42625],[25.12344,55.42813],[25.125,55.43],[25.12656,55.43187],[25.12813,55.43375],[25.12969,55.43563],[25.13125,55.4375],[25.13281,55.43937],[25.13437,55.44125],[25.13594,55.44313],[25.1375,55.445],[25.13906,55.44687],[25.14062,55.44875],[25.14219,55.45063],[25.14375,55.4525],[25.14531,55.45437],[25.14687,55.45625],[25.14844,55.45813],[25.15,55.46]],"note":"Freight and bypass corridor."},{"id":"e77","name":"E77 Expo Road (Jebel Ali–Lehbab)","ar":"طريق إكسبو","type":"highway","limit":100,"coords":[[25.01,55.08],[25.00875,55.08219],[25.0075,55.08438],[25.00625,55.08656],[25.005,55.08875],[25.00375,55.09094],[25.0025,55.09313],[25.00125,55.09531],[25.0,55.0975],[24.99875,55.09969],[24.9975,55.10187],[24.99625,55.10406],[24.995,55.10625],[24.99375,55.10844],[24.9925,55.11062],[24.99125,55.11281],[24.99,55.115],[24.98875,55.11719],[24.9875,55.11938],[24.98625,55.12156],[24.985,55.12375],[24.98375,55.12594],[24.9825,55.12812],[24.98125,55.13031],[24.98,55.1325],[24.97875,55.13469],[24.9775,55.13688],[24.97625,55.13906],[24.975,55.14125],[24.97375,55.14344],[24.9725,55.14562],[24.97125,55.14781],[24.97,55.15],[24.96786,55.15107],[24.96571,55.15214],[24.96357,55.15321],[24.96143,55.15429],[24.95929,55.15536],[24.95714,55.15643],[24.955,55.1575],[24.95286,55.15857],[24.95071,55.15964],[24.94857,55.16071],[24.94643,55.16179],[24.94429,55.16286],[24.94214,55.16393],[24.94,55.165],[24.93775,55.16485],[24.9355,55.1647],[24.93325,55.16455],[24.931,55.1644],[24.92875,55.16425],[24.9265,55.1641],[24.92425,55.16395],[24.922,55.1638],[24.91975,55.16365],[24.9175,55.1635],[24.91525,55.16335],[24.913,55.1632],[24.91075,55.16305],[24.9085,55.1629],[24.90625,55.16275],[24.904,55.1626],[24.90175,55.16245],[24.8995,55.1623],[24.89725,55.16215],[24.895,55.162]],"note":"Links JAFZA gates, Expo City, DIP and DWC."},{"id":"d57","name":"D57 Al Yalayis Street","ar":"شارع اليلايس","type":"slip","limit":80,"coords":[[24.99,55.12],[24.98867,55.122],[24.98733,55.124],[24.986,55.126],[24.98467,55.128],[24.98333,55.13],[24.982,55.132],[24.98067,55.134],[24.97933,55.136],[24.978,55.138],[24.97667,55.14],[24.97533,55.142],[24.974,55.144],[24.97267,55.146],[24.97133,55.148],[24.97,55.15],[24.96885,55.15231],[24.96769,55.15462],[24.96654,55.15692],[24.96538,55.15923],[24.96423,55.16154],[24.96308,55.16385],[24.96192,55.16615],[24.96077,55.16846],[24.95962,55.17077],[24.95846,55.17308],[24.95731,55.17538],[24.95615,55.17769],[24.955,55.18],[24.95353,55.18206],[24.95206,55.18412],[24.95059,55.18618],[24.94912,55.18824],[24.94765,55.19029],[24.94618,55.19235],[24.94471,55.19441],[24.94324,55.19647],[24.94176,55.19853],[24.94029,55.20059],[24.93882,55.20265],[24.93735,55.20471],[24.93588,55.20676],[24.93441,55.20882],[24.93294,55.21088],[24.93147,55.21294],[24.93,55.215]],"note":""},{"id":"d59","name":"D59 Garn Al Sabkha Street","ar":"شارع قرن السبخة","type":"slip","limit":80,"coords":[[25.0,55.15],[25.00111,55.15222],[25.00222,55.15444],[25.00333,55.15667],[25.00444,55.15889],[25.00556,55.16111],[25.00667,55.16333],[25.00778,55.16556],[25.00889,55.16778],[25.01,55.17],[25.01111,55.17222],[25.01222,55.17444],[25.01333,55.17667],[25.01444,55.17889],[25.01556,55.18111],[25.01667,55.18333],[25.01778,55.18556],[25.01889,55.18778],[25.02,55.19],[25.02125,55.19219],[25.0225,55.19438],[25.02375,55.19656],[25.025,55.19875],[25.02625,55.20094],[25.0275,55.20312],[25.02875,55.20531],[25.03,55.2075],[25.03125,55.20969],[25.0325,55.21187],[25.03375,55.21406],[25.035,55.21625],[25.03625,55.21844],[25.0375,55.22062],[25.03875,55.22281],[25.04,55.225]],"note":""},{"id":"d53","name":"D53 Al Maktoum Airport St / JAFZA arteries","ar":"شارع مطار آل مكتوم","type":"slip","limit":80,"coords":[[24.995,55.07],[24.99344,55.07187],[24.99188,55.07375],[24.99031,55.07563],[24.98875,55.0775],[24.98719,55.07937],[24.98562,55.08125],[24.98406,55.08313],[24.9825,55.085],[24.98094,55.08687],[24.97938,55.08875],[24.97781,55.09063],[24.97625,55.0925],[24.97469,55.09437],[24.97312,55.09625],[24.97156,55.09813],[24.97,55.1],[24.96833,55.10167],[24.96667,55.10333],[24.965,55.105],[24.96333,55.10667],[24.96167,55.10833],[24.96,55.11],[24.95833,55.11167],[24.95667,55.11333],[24.955,55.115],[24.95333,55.11667],[24.95167,55.11833],[24.95,55.12],[24.94833,55.12167],[24.94667,55.12333],[24.945,55.125],[24.94333,55.12667],[24.94167,55.12833],[24.94,55.13],[24.93833,55.13167],[24.93667,55.13333],[24.935,55.135],[24.93333,55.13667],[24.93167,55.13833],[24.93,55.14]],"note":""},{"id":"d63","name":"D63 Umm Suqeim Street","ar":"شارع أم سقيم","type":"slip","limit":80,"coords":[[25.13,55.19],[25.13111,55.19222],[25.13222,55.19444],[25.13333,55.19667],[25.13444,55.19889],[25.13556,55.20111],[25.13667,55.20333],[25.13778,55.20556],[25.13889,55.20778],[25.14,55.21],[25.14111,55.21222],[25.14222,55.21444],[25.14333,55.21667],[25.14444,55.21889],[25.14556,55.22111],[25.14667,55.22333],[25.14778,55.22556],[25.14889,55.22778],[25.15,55.23],[25.15111,55.23222],[25.15222,55.23444],[25.15333,55.23667],[25.15444,55.23889],[25.15556,55.24111],[25.15667,55.24333],[25.15778,55.24556],[25.15889,55.24778],[25.16,55.25],[25.16111,55.25222],[25.16222,55.25444],[25.16333,55.25667],[25.16444,55.25889],[25.16556,55.26111],[25.16667,55.26333],[25.16778,55.26556],[25.16889,55.26778],[25.17,55.27]],"note":""},{"id":"d54","name":"D54 Sheikh Zayed Bin Hamdan Al Nahyan St","ar":"شارع الشيخ زايد بن حمدان","type":"slip","limit":80,"coords":[[25.2,55.2],[25.20088,55.20235],[25.20176,55.20471],[25.20265,55.20706],[25.20353,55.20941],[25.20441,55.21176],[25.20529,55.21412],[25.20618,55.21647],[25.20706,55.21882],[25.20794,55.22118],[25.20882,55.22353],[25.20971,55.22588],[25.21059,55.22824],[25.21147,55.23059],[25.21235,55.23294],[25.21324,55.23529],[25.21412,55.23765],[25.215,55.24],[25.21562,55.2425],[25.21625,55.245],[25.21688,55.2475],[25.2175,55.25],[25.21813,55.2525],[25.21875,55.255],[25.21937,55.2575],[25.22,55.26],[25.22063,55.2625],[25.22125,55.265],[25.22188,55.2675],[25.2225,55.27],[25.22312,55.2725],[25.22375,55.275],[25.22438,55.2775],[25.225,55.28]],"note":""},{"id":"e44","name":"E44 Al Khail Road","ar":"شارع الخيل","type":"highway","limit":100,"coords":[[25.115,55.22],[25.1159,55.22231],[25.11679,55.22462],[25.11769,55.22692],[25.11859,55.22923],[25.11949,55.23154],[25.12038,55.23385],[25.12128,55.23615],[25.12218,55.23846],[25.12308,55.24077],[25.12397,55.24308],[25.12487,55.24538],[25.12577,55.24769],[25.12667,55.25],[25.12756,55.25231],[25.12846,55.25462],[25.12936,55.25692],[25.13026,55.25923],[25.13115,55.26154],[25.13205,55.26385],[25.13295,55.26615],[25.13385,55.26846],[25.13474,55.27077],[25.13564,55.27308],[25.13654,55.27538],[25.13744,55.27769],[25.13833,55.28],[25.13923,55.28231],[25.14013,55.28462],[25.14103,55.28692],[25.14192,55.28923],[25.14282,55.29154],[25.14372,55.29385],[25.14462,55.29615],[25.14551,55.29846],[25.14641,55.30077],[25.14731,55.30308],[25.14821,55.30538],[25.1491,55.30769],[25.15,55.31],[25.15091,55.31227],[25.15182,55.31455],[25.15273,55.31682],[25.15364,55.31909],[25.15455,55.32136],[25.15545,55.32364],[25.15636,55.32591],[25.15727,55.32818],[25.15818,55.33045],[25.15909,55.33273],[25.16,55.335],[25.16091,55.33727],[25.16182,55.33955],[25.16273,55.34182],[25.16364,55.34409],[25.16455,55.34636],[25.16545,55.34864],[25.16636,55.35091],[25.16727,55.35318],[25.16818,55.35545],[25.16909,55.35773],[25.17,55.36]],"note":""},{"id":"e66","name":"E66 Dubai–Al Ain Road","ar":"طريق دبي العين","type":"highway","limit":120,"coords":[[25.19,55.36],[25.18857,55.362],[25.18714,55.364],[25.18571,55.366],[25.18429,55.368],[25.18286,55.37],[25.18143,55.372],[25.18,55.374],[25.17857,55.376],[25.17714,55.378],[25.17571,55.38],[25.17429,55.382],[25.17286,55.384],[25.17143,55.386],[25.17,55.388],[25.16857,55.39],[25.16714,55.392],[25.16571,55.394],[25.16429,55.396],[25.16286,55.398],[25.16143,55.4],[25.16,55.402],[25.15857,55.404],[25.15714,55.406],[25.15571,55.408],[25.15429,55.41],[25.15286,55.412],[25.15143,55.414],[25.15,55.416],[25.14857,55.418],[25.14714,55.42],[25.14571,55.422],[25.14429,55.424],[25.14286,55.426],[25.14143,55.428],[25.14,55.43],[25.13879,55.43212],[25.13758,55.43424],[25.13636,55.43636],[25.13515,55.43848],[25.13394,55.44061],[25.13273,55.44273],[25.13152,55.44485],[25.1303,55.44697],[25.12909,55.44909],[25.12788,55.45121],[25.12667,55.45333],[25.12545,55.45545],[25.12424,55.45758],[25.12303,55.4597],[25.12182,55.46182],[25.12061,55.46394],[25.11939,55.46606],[25.11818,55.46818],[25.11697,55.4703],[25.11576,55.47242],[25.11455,55.47455],[25.11333,55.47667],[25.11212,55.47879],[25.11091,55.48091],[25.1097,55.48303],[25.10848,55.48515],[25.10727,55.48727],[25.10606,55.48939],[25.10485,55.49152],[25.10364,55.49364],[25.10242,55.49576],[25.10121,55.49788],[25.1,55.5]],"note":""},{"id":"e11-service","name":"E11 service / collector road","ar":"الطريق الخدمي","type":"slip","limit":60,"coords":[[25.005,55.052],[25.00625,55.05406],[25.0075,55.05613],[25.00875,55.05819],[25.01,55.06025],[25.01125,55.06231],[25.0125,55.06437],[25.01375,55.06644],[25.015,55.0685],[25.01625,55.07056],[25.0175,55.07263],[25.01875,55.07469],[25.02,55.07675],[25.02125,55.07881],[25.0225,55.08087],[25.02375,55.08294],[25.025,55.085],[25.02677,55.08677],[25.02854,55.08854],[25.03031,55.09031],[25.03208,55.09208],[25.03385,55.09385],[25.03562,55.09562],[25.03738,55.09738],[25.03915,55.09915],[25.04092,55.10092],[25.04269,55.10269],[25.04446,55.10446],[25.04623,55.10623],[25.048,55.108],[25.04969,55.10969],[25.05138,55.11138],[25.05308,55.11308],[25.05477,55.11477],[25.05646,55.11646],[25.05815,55.11815],[25.05985,55.11985],[25.06154,55.12154],[25.06323,55.12323],[25.06492,55.12492],[25.06662,55.12662],[25.06831,55.12831],[25.07,55.13]],"note":"Parallel collector/distributor road."},{"id":"d59-flyover","name":"D59 flyover bridge","ar":"جسر","type":"flyover","limit":80,"coords":[[25.012,55.168],[25.01289,55.17044],[25.01378,55.17289],[25.01467,55.17533],[25.01556,55.17778],[25.01644,55.18022],[25.01733,55.18267],[25.01822,55.18511],[25.01911,55.18756],[25.02,55.19],[25.02114,55.19214],[25.02229,55.19429],[25.02343,55.19643],[25.02457,55.19857],[25.02571,55.20071],[25.02686,55.20286],[25.028,55.205]],"note":""},{"id":"d57-loop","name":"D57 / E311 loop ramp","ar":"منحدر دائري","type":"loop","limit":50,"coords":[[24.972,55.153],[24.971,55.1555],[24.97,55.158],[24.966,55.16],[24.9645,55.158],[24.963,55.156],[24.964,55.1535],[24.965,55.151],[24.969,55.15],[24.972,55.153]],"note":""}],"exit":[{"id":"x20","road":"e11","exit":"20","tag":null,"name":"JAFZA South / Jebel Ali Port","ar":"جافزا الجنوب / ميناء جبل علي","lat":24.9881,"lng":55.03857,"dir":"Northeast-bound","limit":100,"tip":"Exit on the right for JAFZA South gates and Jebel Ali Port terminals. Trucks usually take the right-most lanes early.","confidence":"approximate","lanes":{"total":6,"side":"right","dest":[{"label":"Exit 20 · JAFZA South","hold":[5,6],"kind":"exit","note":"Lanes 5–6 become exit lanes; move right before the gantry."},{"label":"Through to Dubai","hold":[1,2,3,4],"kind":"through","note":"Stay left of the solid white line."}]},"recovery":{"uturn":"ut-jafza-s","km":2.4,"min":6,"how":"Take the next exit and use the signalised U-turn."},"km":10.29,"area":"jafza"},{"id":"x22","road":"e11","exit":"22","tag":null,"name":"JAFZA North / Jebel Ali Village","ar":"جافزا الشمال","lat":25.0075,"lng":55.07313,"dir":"Northeast-bound","limit":100,"tip":"Exit right for JAFZA North gates and Jebel Ali Village. Gas stations sit on the service road just before the exit.","confidence":"approximate","lanes":{"total":6,"side":"right","dest":[{"label":"Exit 22 · JAFZA North","hold":[5,6],"kind":"exit","note":"Lane 5 is the optional exit lane; lane 6 exits only."},{"label":"Through to Dubai","hold":[1,2,3,4],"kind":"through","note":""}]},"recovery":{"uturn":"ut-jafza-n","km":1.9,"min":5,"how":"Use the right service road loop after the pedestrian bridge."},"km":14.39,"area":"jafza"},{"id":"x25","road":"e11","exit":"25","tag":null,"name":"Ibn Battuta / Discovery Gardens","ar":"ابن بطوطة / ديسكفري جاردنز","lat":25.04,"lng":55.115,"dir":"Northeast-bound","limit":100,"tip":"Exit right for Ibn Battuta Mall, Discovery Gardens and Al Furjan.","confidence":"approximate","lanes":{"total":6,"side":"right","dest":[{"label":"Exit 25 · Ibn Battuta","hold":[5,6],"kind":"exit","note":"Early right-lane entry avoids last-second weaving."},{"label":"Through to Marina / Downtown","hold":[1,2,3,4],"kind":"through","note":""}]},"recovery":{"uturn":"ut-ibn","km":3.1,"min":8,"how":"Continue to the Gardens interchange and loop back."},"km":20.0,"area":null},{"id":"x27","road":"e11","exit":"27","tag":null,"name":"The Gardens / Jebel Ali Village","ar":"الجاردنز","lat":25.05438,"lng":55.12781,"dir":"Northeast-bound","limit":100,"tip":"Right exit towards The Gardens and Discovery Gardens north side.","confidence":"approximate","lanes":{"total":6,"side":"right","dest":[{"label":"Exit 27 · The Gardens","hold":[6],"kind":"exit","note":"Single exit lane."},{"label":"Through","hold":[1,2,3,4,5],"kind":"through","note":""}]},"recovery":{"uturn":"ut-ibn","km":2.2,"min":6,"how":"Turn back via Ibn Battuta U-turn bridge."},"km":22.05,"area":null},{"id":"x29","road":"e11","exit":"29","tag":null,"name":"Jumeirah Lakes Towers (JLT)","ar":"أبراج بحيرات جميرا","lat":25.06938,"lng":55.14031,"dir":"Northeast-bound","limit":100,"tip":"Right exit for JLT and the Marina south entry.","confidence":"approximate","lanes":{"total":6,"side":"right","dest":[{"label":"Exit 29 · JLT","hold":[5,6],"kind":"exit","note":"Right two lanes."},{"label":"Through","hold":[1,2,3,4],"kind":"through","note":""}]},"recovery":{"uturn":"ut-marina","km":2.8,"min":7,"how":"Continue to Marina U-turn then return."},"km":24.14,"area":null},{"id":"x32","road":"e11","exit":"32","tag":null,"name":"Dubai Marina / Al Sufouh","ar":"دبي مارينا","lat":25.08289,"lng":55.15421,"dir":"Northeast-bound","limit":100,"tip":"Right exit for Dubai Marina, Al Sufouh Road and JBR.","confidence":"approximate","lanes":{"total":6,"side":"right","dest":[{"label":"Exit 32 · Dubai Marina","hold":[5,6],"kind":"exit","note":"Exit lanes diverge on a short collector road."},{"label":"Through to Downtown","hold":[1,2,3,4],"kind":"through","note":""}]},"recovery":{"uturn":"ut-marina","km":1.4,"min":5,"how":"U-turn bridge after the Marina interchange."},"km":26.2,"area":null},{"id":"x-moe","road":"e11","exit":null,"tag":"MoE","name":"Mall of the Emirates / Al Barsha","ar":"مول الإمارات","lat":25.12038,"lng":55.19923,"dir":"Northeast-bound","limit":100,"tip":"Exit right for Mall of the Emirates and Al Barsha. Salik gate follows shortly after.","confidence":"approximate","lanes":{"total":6,"side":"right","dest":[{"label":"Mall of the Emirates","hold":[5,6],"kind":"exit","note":""},{"label":"Through to Downtown","hold":[1,2,3,4],"kind":"through","note":""}]},"km":32.36,"area":null},{"id":"x-dt","road":"e11","exit":null,"tag":"DT","name":"Downtown Dubai / Burj Khalifa","ar":"وسط مدينة دبي","lat":25.19135,"lng":55.26724,"dir":"Northeast-bound","limit":100,"tip":"Interchange for Downtown, Business Bay and Al Khail Road.","confidence":"approximate","lanes":{"total":7,"side":"right","dest":[{"label":"Downtown / Business Bay","hold":[6,7],"kind":"exit","note":""},{"label":"Through to Trade Centre","hold":[1,2,3,4,5],"kind":"through","note":""}]},"km":42.83,"area":null},{"id":"x-wtc","road":"e11","exit":null,"tag":"WTC","name":"Trade Centre","ar":"المركز التجاري","lat":25.2214,"lng":55.2866,"dir":"Northeast-bound","limit":100,"tip":"End of the mapped E11 corridor at the Trade Centre roundabout area.","confidence":"approximate","km":46.7,"area":null},{"id":"x311-jai","road":"e311","exit":null,"tag":"JAI","name":"E311 / Jebel Ali Industrial","ar":"جبل علي الصناعية","lat":24.96,"lng":55.13714,"dir":"Northeast-bound","limit":120,"tip":"Entry/exit for Jebel Ali Industrial 1–3. Heavy trucks very common — keep a long following distance.","confidence":"approximate","lanes":{"total":4,"side":"right","dest":[{"label":"Jebel Ali Industrial","hold":[4],"kind":"exit","note":"Single right exit lane."},{"label":"Through to DIP / Expo","hold":[1,2,3],"kind":"through","note":""}]},"km":2.05,"area":null},{"id":"x311-expo","road":"e311","exit":null,"tag":"EXPO","name":"E311 / Expo City & DWC link","ar":"إكسبو سيتي","lat":24.98375,"lng":55.17786,"dir":"Northeast-bound","limit":120,"tip":"Exit for Expo Road (E77), Expo City Dubai and Al Maktoum Airport.","confidence":"approximate","lanes":{"total":5,"side":"right","dest":[{"label":"Expo City / DWC (E77)","hold":[4,5],"kind":"exit","note":""},{"label":"Through","hold":[1,2,3],"kind":"through","note":""}]},"km":6.94,"area":null},{"id":"x311-dip","road":"e311","exit":null,"tag":"DIP","name":"E311 / Dubai Investment Park","ar":"واحة دبي للاستثمار","lat":24.97625,"lng":55.165,"dir":"Northeast-bound","limit":120,"tip":"Exit for DIP 1 and 2 via Al Yalayis (D57).","confidence":"approximate","km":5.39,"area":null},{"id":"x311-gv","road":"e311","exit":null,"tag":"GV","name":"E311 / Global Village","ar":"القرية العالمية","lat":25.07,"lng":55.305,"dir":"Northeast-bound","limit":120,"tip":"Exit for Global Village and Dubai Sports City. Seasonal heavy traffic.","confidence":"approximate","km":22.95,"area":null},{"id":"x311-mirdif","road":"e311","exit":null,"tag":"MRD","name":"E311 / Mirdif","ar":"مردف","lat":25.191,"lng":55.438,"dir":"Northeast-bound","limit":120,"tip":"Exit for Mirdif and Al Khawaneej.","confidence":"approximate","km":41.95,"area":null}],"split":[{"id":"sp-jafza","road":"e11","name":"JAFZA North vs South split (Exit 20 / 22)","ar":"تفرع جافزا","lat":24.99643,"lng":55.05357,"tip":"Decide before the gantry: South gates exit first, North gates 2 km later.","lanes":{"total":6,"side":"right","dest":[{"label":"JAFZA South (Exit 20)","hold":[6],"kind":"exit","note":"Rightmost lane only."},{"label":"JAFZA North (Exit 22)","hold":[5,6],"kind":"exit","note":"Hold lane 5–6 past Exit 20."},{"label":"Through to Dubai","hold":[1,2,3,4],"kind":"through","note":""}]},"confidence":"approximate","area":"jafza","km":12.07},{"id":"sp-marina","road":"e11","name":"Ibn Battuta · Gardens · JLT · Marina splits (Exits 25–32)","ar":"تفرعات ابن بطوطة والمارينا","lat":25.06375,"lng":55.13563,"tip":"Four exits in 8 km: stay in lanes 4–5 and exit one at a time. Do not cut across the dashed lines.","lanes":{"total":6,"side":"right","dest":[{"label":"Ibn Battuta (25)","hold":[5,6],"kind":"exit","note":""},{"label":"The Gardens (27)","hold":[6],"kind":"exit","note":""},{"label":"JLT (29)","hold":[5,6],"kind":"exit","note":""},{"label":"Dubai Marina (32)","hold":[5,6],"kind":"exit","note":""}]},"confidence":"approximate","km":23.36,"area":null},{"id":"sp-yalayis","road":"d57","name":"Al Yalayis (D57) → E311 North / South loop ramps","ar":"تفرع اليلايس","lat":24.96885,"lng":55.15231,"tip":"Left loop ramp = E311 north to Sharjah. Right ramp = E311 south to Abu Dhabi.","lanes":{"total":4,"side":"left","dest":[{"label":"E311 North · Sharjah","hold":[1,2],"kind":"exit","note":"Left loop ramp — keep left from the start."},{"label":"E311 South · Abu Dhabi","hold":[3,4],"kind":"exit","note":"Right-side ramp."}]},"confidence":"approximate","km":4.02,"area":null},{"id":"sp-garn","road":"d59","name":"Garn Al Sabkha (D59) braided interchange","ar":"تقاطع قرن السبخة","lat":25.01333,"lng":55.17667,"tip":"Multi-bridge braided interchange: your lane is fixed 600 m before the bridge. Follow the overhead gantry only.","lanes":{"total":5,"side":"right","dest":[{"label":"Flyover straight (D59)","hold":[2,3],"kind":"through","note":"Elevated bridge — keep centre."},{"label":"Right to E11","hold":[4,5],"kind":"exit","note":"Right bridge loop."},{"label":"Left to E611 side","hold":[1],"kind":"exit","note":"Leftmost lane only."}]},"confidence":"approximate","km":3.07,"area":null},{"id":"sp-freeright","road":"e11-service","name":"Free-right slip lane vs signalised right","ar":"الانعطاف الحر لليمين","lat":25.03208,"lng":55.09208,"tip":"Free-right: yield sign, no signal, radar camera at the stop line. Signalised right: wait for green arrow.","lanes":{"total":3,"side":"right","dest":[{"label":"Free-right slip lane","hold":[3],"kind":"exit","note":"Yield to merging traffic; speed camera at the end."},{"label":"Signalised right turn","hold":[2],"kind":"exit","note":"Wait for the signal; do not use the slip lane."},{"label":"Straight","hold":[1],"kind":"through","note":""}]},"confidence":"approximate","km":5.06,"area":null}],"uturn":[{"id":"ut-jafza-s","name":"JAFZA South U-turn bridge","ar":"دوار جافزا الجنوب","lat":24.972,"lng":55.052,"type":"loop","approach":60,"approach_lane":"right","zone":"jafza","how":"Use right service road loop under the bridge — free flow, no signal.","confidence":"approximate"},{"id":"ut-jafza-n","name":"JAFZA North U-turn (signalised)","ar":"دوار جافزا الشمال","lat":25.012,"lng":55.092,"type":"signal","approach":60,"approach_lane":"left","zone":"jafza","how":"Approach from the leftmost lane only; wait for the U-turn arrow.","confidence":"approximate","road":"e11","km":16.22},{"id":"ut-ra-jafza","name":"JAFZA R/A U-turn (roundabout)","ar":"دوار","lat":24.985,"lng":55.07,"type":"ra","approach":90,"approach_lane":"left","zone":"jafza","how":"Yield to traffic already inside the roundabout; go around to the exit you came from.","confidence":"approximate","road":"e11","km":12.83},{"id":"ut-jai1","name":"Jebel Ali Industrial 1 U-turn","ar":"جبل علي الصناعية ١","lat":24.985,"lng":55.105,"type":"signal","approach":45,"approach_lane":"left","zone":"jebel-ali-industrial","how":"Far-left lane; heavy trucks turn wide — wait behind the stop line.","confidence":"approximate","road":"e77","km":3.65},{"id":"ut-jai2","name":"Jebel Ali Industrial 2 U-turn bridge","ar":"جبل علي الصناعية ٢","lat":24.968,"lng":55.125,"type":"loop","approach":50,"approach_lane":"right","zone":"jebel-ali-industrial","how":"Flyover loop, one lane; keep 80 km/h on the ramp.","confidence":"approximate","road":"e311","km":1.54},{"id":"ut-jai3","name":"Jebel Ali Industrial 3 R/A U-turn","ar":"جبل علي الصناعية ٣","lat":24.952,"lng":55.145,"type":"ra","approach":45,"approach_lane":"left","zone":"jebel-ali-industrial","how":"Roundabout U-turn; give way to the right.","confidence":"approximate","road":"e311","km":2.31},{"id":"ut-ibn","name":"Ibn Battuta U-turn bridge","ar":"جسر الدوران ابن بطوطة","lat":25.048,"lng":55.124,"type":"loop","approach":50,"approach_lane":"right","zone":"szr","how":"Use the right service road loop after the Ibn Battuta exit.","confidence":"approximate","road":"e11","km":21.27},{"id":"ut-marina","name":"Marina U-turn (underpass)","ar":"نفق الدوران","lat":25.09,"lng":55.158,"type":"loop","approach":50,"approach_lane":"left","zone":"szr","how":"Underpass U-turn: far-left lane, dashed line at the portal.","confidence":"approximate","road":"e11","km":26.97},{"id":"ut-dg","name":"Discovery Gardens U-turn","ar":"ديسكفري جاردنز","lat":25.038,"lng":55.148,"type":"signal","approach":90,"approach_lane":"left","zone":"discovery-gardens","how":"Signalised; approach from the far-left lane.","confidence":"approximate"},{"id":"ut-dg2","name":"Discovery Gardens R/A U-turn","ar":"ديسكفري جاردنز","lat":25.043,"lng":55.141,"type":"ra","approach":270,"approach_lane":"left","zone":"discovery-gardens","how":"Roundabout at the Gardens spine road.","confidence":"approximate","road":"e11","km":21.79},{"id":"ut-dip1","name":"DIP 1 U-turn (signalised)","ar":"واحة دبي للاستثمار ١","lat":24.976,"lng":55.172,"type":"signal","approach":90,"approach_lane":"left","zone":"dip","how":"Left lane only; two-phase signal.","confidence":"approximate","road":"e311","km":5.91},{"id":"ut-dip2","name":"DIP 2 flyover loop","ar":"واحة دبي للاستثمار ٢","lat":24.962,"lng":55.19,"type":"loop","approach":45,"approach_lane":"right","zone":"dip","how":"Flyover loop; give way to merging traffic.","confidence":"approximate","road":"d57","km":7.47},{"id":"ut-szr1","name":"Sheikh Zayed Rd service road U-turn (Al Barsha)","ar":"شارع الخدمة","lat":25.113,"lng":55.19,"type":"loop","approach":60,"approach_lane":"right","zone":"szr","how":"Use right service road loop.","confidence":"approximate","road":"e11","km":31.07},{"id":"ut-szr2","name":"Sheikh Zayed Rd service road U-turn (Safa)","ar":"شارع الخدمة","lat":25.17,"lng":55.245,"type":"signal","approach":60,"approach_lane":"left","zone":"szr","how":"Approach from the left service lane.","confidence":"approximate","road":"e11","km":39.67}],"gas":[{"id":"g1","brand":"ADNOC","name":"ADNOC · JAFZA North","ar":"أدنوك جافزا الشمال","lat":25.005,"lng":55.082,"entry":60,"how":"Take the service road 400 m before Exit 22; keep right after the pedestrian bridge.","confidence":"approximate (brand and position indicative)","h24":true,"zoom":true,"wash":true,"air":true,"prayer":true,"diesel":true,"ev":false,"truck":false,"area":"jafza","road":"e77","km":0.52},{"id":"g2","brand":"ENOC","name":"ENOC · JAFZA South","ar":"إينوك جافزا الجنوب","lat":24.99,"lng":55.055,"entry":60,"how":"Enter from the JAFZA South access road, right side before Gate 8.","confidence":"approximate (brand and position indicative)","h24":true,"zoom":true,"wash":true,"air":true,"prayer":true,"diesel":true,"ev":true,"truck":true,"area":"jafza","road":"e11","km":11.81},{"id":"g3","brand":"EMARAT","name":"Emarat · Jebel Ali Industrial 1","ar":"إمارات جبل علي الصناعية","lat":24.977,"lng":55.113,"entry":60,"how":"Right slip road after the JAI 1 junction; trucks use the left bay.","confidence":"approximate (brand and position indicative)","h24":true,"zoom":false,"wash":false,"air":true,"prayer":true,"diesel":true,"ev":false,"truck":true,"area":"industrial","road":"e77","km":4.69},{"id":"g4","brand":"ADNOC","name":"ADNOC · E11 Northeast-bound (Exit 22)","ar":"أدنوك طريق الشيخ زايد","lat":25.0,"lng":55.068,"entry":50,"how":"Slip-road entry 600 m after Exit 20 on the right.","confidence":"approximate (brand and position indicative)","h24":true,"zoom":true,"wash":true,"air":true,"prayer":true,"diesel":false,"ev":true,"truck":false,"road":"e11","km":13.61},{"id":"g5","brand":"ENOC","name":"ENOC · E11 Southwest-bound (Jebel Ali)","ar":"إينوك طريق الشيخ زايد","lat":25.009,"lng":55.082,"entry":230,"how":"Left-hand slip road; keep left after the camera.","confidence":"approximate (brand and position indicative)","h24":true,"zoom":true,"wash":false,"air":true,"prayer":true,"diesel":true,"ev":false,"truck":false,"road":"e77","km":0.26},{"id":"g6","brand":"ADNOC","name":"ADNOC · E77 Expo Road","ar":"أدنوك طريق إكسبو","lat":24.985,"lng":55.123,"entry":45,"how":"Entry on the right 500 m after the JAFZA gate junction.","confidence":"approximate (brand and position indicative)","h24":true,"zoom":true,"wash":true,"air":true,"prayer":true,"diesel":true,"ev":true,"truck":true,"road":"e77","km":5.21},{"id":"g7","brand":"EMARAT","name":"Emarat · Al Yalayis (D57)","ar":"إمارات اليلايس","lat":24.965,"lng":55.175,"entry":60,"how":"Service lane on the right before the D57 / E311 loop.","confidence":"approximate (brand and position indicative)","h24":true,"zoom":false,"wash":true,"air":true,"prayer":true,"diesel":true,"ev":false,"truck":true,"road":"d57","km":6.14},{"id":"g8","brand":"ENOC","name":"ENOC · Dubai Investment Park","ar":"إينوك واحة دبي للاستثمار","lat":24.98,"lng":55.176,"entry":90,"how":"Enter from the DIP spine road, right side after the roundabout.","confidence":"approximate (brand and position indicative)","h24":true,"zoom":true,"wash":true,"air":true,"prayer":true,"diesel":true,"ev":true,"truck":false,"road":"e311","km":6.68},{"id":"g9","brand":"ADNOC","name":"ADNOC · Ibn Battuta","ar":"أدنوك ابن بطوطة","lat":25.036,"lng":55.113,"entry":60,"how":"Take the Exit 25 slip road; station is on the right after 250 m.","confidence":"approximate (brand and position indicative)","h24":true,"zoom":true,"wash":true,"air":true,"prayer":true,"diesel":false,"ev":true,"truck":false,"road":"e11","km":19.5},{"id":"g10","brand":"EMARAT","name":"Emarat · Discovery Gardens","ar":"إمارات ديسكفري جاردنز","lat":25.041,"lng":55.145,"entry":60,"how":"From Al Furjan road, left turn after the roundabout.","confidence":"approximate (brand and position indicative)","h24":false,"zoom":false,"wash":false,"air":true,"prayer":true,"diesel":false,"ev":false,"truck":false},{"id":"g11","brand":"ENOC","name":"ENOC · Jebel Ali Port gate","ar":"إينوك ميناء جبل علي","lat":25.005,"lng":55.045,"entry":60,"how":"Truck queue lane on the left; cars take the right pumps.","confidence":"approximate (brand and position indicative)","h24":true,"zoom":false,"wash":false,"air":true,"prayer":true,"diesel":true,"ev":false,"truck":true,"area":"jafza","road":"e11","km":11.81},{"id":"g12","brand":"ADNOC","name":"ADNOC Truck Stop · Jebel Ali Industrial 2","ar":"أدنوك محطة الشاحنات","lat":24.968,"lng":55.128,"entry":60,"how":"Heavy-truck bays; enter from the E311 service lane on the right.","confidence":"approximate (brand and position indicative)","h24":true,"zoom":true,"wash":true,"air":true,"prayer":true,"diesel":true,"ev":false,"truck":true,"area":"industrial","road":"e311","km":1.8},{"id":"g13","brand":"ENOC","name":"ENOC · Mall of the Emirates","ar":"إينوك مول الإمارات","lat":25.116,"lng":55.196,"entry":60,"how":"Right slip road after Exit MoE; EV chargers at the rear.","confidence":"approximate (brand and position indicative)","h24":true,"zoom":true,"wash":true,"air":true,"prayer":true,"diesel":false,"ev":true,"truck":false,"road":"e11","km":31.85}],"gate":[{"id":"gate1","gate":1,"name":"JAFZA North · Gate 1","ar":"جافزا بوابة 1","lat":25.019,"lng":55.062,"truck":false,"area":"jafza","tip":"Security checkpoint — Free Zone access pass required.","confidence":"schematic (confirm gate numbers with JAFZA)","road":"e11","km":14.13},{"id":"gate2","gate":2,"name":"JAFZA North · Gate 2","ar":"جافزا بوابة 2","lat":25.019,"lng":55.0695,"truck":true,"area":"jafza","tip":"Security checkpoint — Free Zone access pass required. Cargo gates are indicated in amber.","confidence":"schematic (confirm gate numbers with JAFZA)","road":"e11","km":14.65},{"id":"gate3","gate":3,"name":"JAFZA North · Gate 3","ar":"جافزا بوابة 3","lat":25.019,"lng":55.077,"truck":false,"area":"jafza","tip":"Security checkpoint — Free Zone access pass required.","confidence":"schematic (confirm gate numbers with JAFZA)","road":"e11","km":15.43},{"id":"gate4","gate":4,"name":"JAFZA North · Gate 4","ar":"جافزا بوابة 4","lat":25.019,"lng":55.0845,"truck":false,"area":"jafza","tip":"Security checkpoint — Free Zone access pass required.","confidence":"schematic (confirm gate numbers with JAFZA)","road":"e11","km":15.95},{"id":"gate5","gate":5,"name":"JAFZA North · Gate 5","ar":"جافزا بوابة 5","lat":25.019,"lng":55.092,"truck":true,"area":"jafza","tip":"Security checkpoint — Free Zone access pass required. Cargo gates are indicated in amber.","confidence":"schematic (confirm gate numbers with JAFZA)","road":"e11","km":16.74},{"id":"gate6","gate":6,"name":"JAFZA North · Gate 6","ar":"جافزا بوابة 6","lat":25.019,"lng":55.0995,"truck":false,"area":"jafza","tip":"Security checkpoint — Free Zone access pass required.","confidence":"schematic (confirm gate numbers with JAFZA)","road":"e11","km":17.25},{"id":"gate7","gate":7,"name":"JAFZA South · Gate 7","ar":"جافزا بوابة 7","lat":24.972,"lng":55.034,"truck":false,"area":"jafza","tip":"Security checkpoint — Free Zone access pass required.","confidence":"schematic (confirm gate numbers with JAFZA)","road":"e11","km":9.03},{"id":"gate8","gate":8,"name":"JAFZA South · Gate 8","ar":"جافزا بوابة 8","lat":24.972,"lng":55.04,"truck":true,"area":"jafza","tip":"Security checkpoint — Free Zone access pass required. Cargo gates are indicated in amber.","confidence":"schematic (confirm gate numbers with JAFZA)","road":"e11","km":9.53},{"id":"gate9","gate":9,"name":"JAFZA South · Gate 9","ar":"جافزا بوابة 9","lat":24.972,"lng":55.046,"truck":false,"area":"jafza","tip":"Security checkpoint — Free Zone access pass required.","confidence":"schematic (confirm gate numbers with JAFZA)","road":"e11","km":10.04},{"id":"gate10","gate":10,"name":"JAFZA South · Gate 10","ar":"جافزا بوابة 10","lat":24.972,"lng":55.052,"truck":false,"area":"jafza","tip":"Security checkpoint — Free Zone access pass required.","confidence":"schematic (confirm gate numbers with JAFZA)"},{"id":"gate11","gate":11,"name":"JAFZA South · Gate 11","ar":"جافزا بوابة 11","lat":24.972,"lng":55.058,"truck":true,"area":"jafza","tip":"Security checkpoint — Free Zone access pass required. Cargo gates are indicated in amber.","confidence":"schematic (confirm gate numbers with JAFZA)"},{"id":"gate12","gate":12,"name":"JAFZA South · Gate 12","ar":"جافزا بوابة 12","lat":24.972,"lng":55.064,"truck":false,"area":"jafza","tip":"Security checkpoint — Free Zone access pass required.","confidence":"schematic (confirm gate numbers with JAFZA)"}],"ra":[{"id":"ra1","name":"JAFZA R/A 1","ar":"دوار 1","lat":24.978,"lng":55.04,"area":"jafza","tip":"Give way to traffic in the roundabout. Heavy trucks use the outer lane.","confidence":"schematic (confirm R/A numbers on site)"},{"id":"ra2","name":"JAFZA R/A 2","ar":"دوار 2","lat":24.978,"lng":55.055,"area":"jafza","tip":"Give way to traffic in the roundabout. Heavy trucks use the outer lane.","confidence":"schematic (confirm R/A numbers on site)"},{"id":"ra3","name":"JAFZA R/A 3","ar":"دوار 3","lat":24.978,"lng":55.07,"area":"jafza","tip":"Give way to traffic in the roundabout. Heavy trucks use the outer lane.","confidence":"schematic (confirm R/A numbers on site)"},{"id":"ra4","name":"JAFZA R/A 4","ar":"دوار 4","lat":24.978,"lng":55.085,"area":"jafza","tip":"Give way to traffic in the roundabout. Heavy trucks use the outer lane.","confidence":"schematic (confirm R/A numbers on site)"},{"id":"ra5","name":"JAFZA R/A 5","ar":"دوار 5","lat":24.978,"lng":55.1,"area":"jafza","tip":"Give way to traffic in the roundabout. Heavy trucks use the outer lane.","confidence":"schematic (confirm R/A numbers on site)"},{"id":"ra6","name":"JAFZA R/A 6","ar":"دوار 6","lat":24.992,"lng":55.04,"area":"jafza","tip":"Give way to traffic in the roundabout. Heavy trucks use the outer lane.","confidence":"schematic (confirm R/A numbers on site)"},{"id":"ra7","name":"JAFZA R/A 7","ar":"دوار 7","lat":24.992,"lng":55.055,"area":"jafza","tip":"Give way to traffic in the roundabout. Heavy trucks use the outer lane.","confidence":"schematic (confirm R/A numbers on site)"},{"id":"ra8","name":"JAFZA R/A 8","ar":"دوار 8","lat":24.992,"lng":55.07,"area":"jafza","tip":"Give way to traffic in the roundabout. Heavy trucks use the outer lane.","confidence":"schematic (confirm R/A numbers on site)"},{"id":"ra9","name":"JAFZA R/A 9","ar":"دوار 9","lat":24.992,"lng":55.085,"area":"jafza","tip":"Give way to traffic in the roundabout. Heavy trucks use the outer lane.","confidence":"schematic (confirm R/A numbers on site)"},{"id":"ra10","name":"JAFZA R/A 10","ar":"دوار 10","lat":24.992,"lng":55.1,"area":"jafza","tip":"Give way to traffic in the roundabout. Heavy trucks use the outer lane.","confidence":"schematic (confirm R/A numbers on site)"},{"id":"ra11","name":"JAFZA R/A 11","ar":"دوار 11","lat":25.006,"lng":55.04,"area":"jafza","tip":"Give way to traffic in the roundabout. Heavy trucks use the outer lane.","confidence":"schematic (confirm R/A numbers on site)"},{"id":"ra12","name":"JAFZA R/A 12","ar":"دوار 12","lat":25.006,"lng":55.055,"area":"jafza","tip":"Give way to traffic in the roundabout. Heavy trucks use the outer lane.","confidence":"schematic (confirm R/A numbers on site)"},{"id":"ra13","name":"JAFZA R/A 13","ar":"دوار 13","lat":25.006,"lng":55.07,"area":"jafza","tip":"Give way to traffic in the roundabout. Heavy trucks use the outer lane.","confidence":"schematic (confirm R/A numbers on site)"},{"id":"ra14","name":"JAFZA R/A 14","ar":"دوار 14","lat":25.006,"lng":55.085,"area":"jafza","tip":"Give way to traffic in the roundabout. Heavy trucks use the outer lane.","confidence":"schematic (confirm R/A numbers on site)"},{"id":"ra15","name":"JAFZA R/A 15","ar":"دوار 15","lat":25.006,"lng":55.1,"area":"jafza","tip":"Give way to traffic in the roundabout. Heavy trucks use the outer lane.","confidence":"schematic (confirm R/A numbers on site)"}],"hub":[{"id":"t1","name":"Jebel Ali Port · Terminal 1","ar":"ميناء جبل علي المحطة ١","lat":25.012,"lng":55.022,"tip":"Container terminal. Port pass and customs documents required.","confidence":"approximate","area":"jafza"},{"id":"t2","name":"Jebel Ali Port · Terminal 2","ar":"ميناء جبل علي المحطة ٢","lat":25.005,"lng":55.03,"tip":"Container terminal.","confidence":"approximate","area":"jafza"},{"id":"t3","name":"Jebel Ali Port · Terminal 3","ar":"ميناء جبل علي المحطة ٣","lat":24.998,"lng":55.037,"tip":"Container terminal.","confidence":"approximate","area":"jafza","road":"e11","km":10.8},{"id":"t4","name":"Jebel Ali Port · Terminal 4","ar":"ميناء جبل علي المحطة ٤","lat":24.99,"lng":55.044,"tip":"Container terminal.","confidence":"approximate","area":"jafza","road":"e11","km":10.8},{"id":"customs","name":"Customs Checkpoint · Jebel Ali","ar":"نقطة الجمارك","lat":24.995,"lng":55.062,"tip":"Customs inspection and documentation offices for the Free Zone.","confidence":"approximate","area":"jafza","road":"e11","km":12.83},{"id":"jai1","name":"Jebel Ali Industrial Area 1","ar":"جبل علي الصناعية ١","lat":24.985,"lng":55.1,"tip":"Workshops, labour-camp corridors and truck stops.","confidence":"approximate","area":"industrial","road":"e77","km":3.13},{"id":"jai2","name":"Jebel Ali Industrial Area 2","ar":"جبل علي الصناعية ٢","lat":24.968,"lng":55.12,"tip":"Truck stops and service roads.","confidence":"approximate","area":"industrial","road":"e311","km":1.03},{"id":"jai3","name":"Jebel Ali Industrial Area 3","ar":"جبل علي الصناعية ٣","lat":24.952,"lng":55.142,"tip":"Wide streets, frequent heavy trucks.","confidence":"approximate","area":"industrial","road":"e311","km":2.05},{"id":"mena","name":"Mena Jebel Ali","ar":"مينا جبل علي","lat":25.0,"lng":55.0985,"tip":"Local commercial area.","confidence":"approximate","road":"e77","km":2.08},{"id":"palm","name":"Palm Jebel Ali entrance","ar":"مدخل نخلة جبل علي","lat":25.0,"lng":55.005,"tip":"Access road towards the Palm Jebel Ali development.","confidence":"approximate"},{"id":"ibn-mall","name":"Ibn Battuta Mall","ar":"ابن بطوطة مول","lat":25.0448,"lng":55.1175,"tip":"Parking: follow Exit 25 signs; roundabout entries on both sides.","confidence":"approximate","road":"e11","km":20.5},{"id":"festival","name":"Festival Plaza (IKEA)","ar":"فستيفال بلازا","lat":25.0015,"lng":55.1055,"tip":"Between JAFZA North and Jebel Ali Village.","confidence":"approximate","road":"e77","km":2.61},{"id":"dg","name":"Discovery Gardens","ar":"ديسكفري جاردنز","lat":25.04,"lng":55.1455,"tip":"Residential; use the Gardens spine road.","confidence":"approximate"},{"id":"furjan","name":"Al Furjan","ar":"الفرجان","lat":25.021,"lng":55.152,"tip":"Residential community by the Al Furjan road.","confidence":"approximate","road":"d59","km":1.28},{"id":"parks","name":"Dubai Parks & Resorts","ar":"دبي باركس","lat":24.9185,"lng":55.0087,"tip":"Via Sheikh Zayed Road southwest of Jebel Ali.","confidence":"approximate"}],"metro":[{"id":"m-expo","name":"Expo 2020 Metro","ar":"إكسبو 2020","lat":24.9647,"lng":55.1494,"tip":"Dubai Metro Red Line station.","confidence":"approximate"},{"id":"m-jebel","name":"UAE Exchange Metro (Jabal Ali)","ar":"يو إيه إي إكستشنج","lat":25.0035,"lng":55.0735,"tip":"Dubai Metro Red Line station.","confidence":"approximate"},{"id":"m-danube","name":"Danube Metro","ar":"الدانوب","lat":25.0085,"lng":55.0825,"tip":"Dubai Metro Red Line station.","confidence":"approximate"},{"id":"m-energy","name":"Energy Metro","ar":"إنرجي","lat":25.0185,"lng":55.1005,"tip":"Dubai Metro Red Line station.","confidence":"approximate"},{"id":"m-ibn","name":"Ibn Battuta Metro","ar":"ابن بطوطة","lat":25.0455,"lng":55.12,"tip":"Dubai Metro Red Line station.","confidence":"approximate"}],"salik":[{"id":"s-jebel","road":"e11","name":"Salik Gate · Jebel Ali (E11)","ar":"سالك جبل علي","lat":25.00125,"lng":55.06219,"tip":"Gantry over E11. Tag must have balance. Fine for crossing without a tag.","confidence":"approximate","km":13.09,"area":null},{"id":"s-barsha","road":"e11","name":"Salik Gate · Al Barsha (E11)","ar":"سالك البرشاء","lat":25.11731,"lng":55.19538,"tip":"Gantry over E11. Tag must have balance. Fine for crossing without a tag.","confidence":"approximate","km":31.85,"area":null},{"id":"s-safa","road":"e11","name":"Salik Gate · Al Safa (E11)","ar":"سالك الصفا","lat":25.17441,"lng":55.25294,"tip":"Gantry over E11. Tag must have balance. Fine for crossing without a tag.","confidence":"approximate","km":40.46,"area":null}],"zones":[{"id":"z-n","name":"JAFZA North","color":"#10b981","coords":[[24.995,55.055],[24.995,55.105],[25.022,55.105],[25.022,55.075]]},{"id":"z-s","name":"JAFZA South","color":"#06b6d4","coords":[[24.965,55.03],[24.965,55.078],[24.994,55.078],[24.994,55.03]]},{"id":"z-p","name":"Jebel Ali Port Terminals T1–T4","color":"#f59e0b","coords":[[24.985,55.01],[24.985,55.05],[25.02,55.05],[25.03,55.015]]}],"routes":[{"id":"r1","name":"Ibn Battuta → JAFZA South Gate 8 (E11 southwest-bound)","steps":[{"text":"Start at Ibn Battuta Mall. Join E11 towards Abu Dhabi.","item":null,"dest":0,"lat":25.0448,"lng":55.1175},{"text":"Keep left for the through lanes on Sheikh Zayed Road.","item":"sp-marina","dest":3,"lat":25.06375,"lng":55.13563},{"text":"Continue southwest. Salik gate ahead at Jebel Ali.","item":null,"dest":0,"lat":25.0,"lng":55.062},{"text":"In 800 metres, Exit 22 JAFZA North. Keep left to continue to JAFZA South.","item":"x22","dest":1,"lat":25.0075,"lng":55.07313},{"text":"Exit 20 JAFZA South ahead. Move to lane 6 now and keep right.","item":"x20","dest":0,"lat":24.9881,"lng":55.03857},{"text":"Follow the right service road to Gate 8 and the ENOC station.","item":"g2","dest":0,"lat":24.99,"lng":55.055}]},{"id":"r2","name":"JAFZA North → Expo City via E77 and E311","steps":[{"text":"Leave JAFZA North on E77 towards Expo City.","item":null,"dest":0,"lat":25.01,"lng":55.08},{"text":"Continue on E77 southeast past Jebel Ali Industrial.","item":null,"dest":0,"lat":24.99,"lng":55.115},{"text":"Join E311. Exit lanes for Expo City are the two on the right.","item":"x311-expo","dest":0,"lat":24.98375,"lng":55.17786},{"text":"Arrive at Expo City.","item":null,"dest":0,"lat":24.9647,"lng":55.1537}]},{"id":"r3","name":"Dubai Marina → Downtown on E11","steps":[{"text":"Join E11 northeast at Exit 32.","item":"x32","dest":1,"lat":25.08289,"lng":55.15421},{"text":"Mall of the Emirates ahead. Stay in lanes 1–4.","item":"x-moe","dest":1,"lat":25.12038,"lng":55.19923},{"text":"Salik gate at Al Barsha.","item":null,"dest":0,"lat":25.115,"lng":55.196},{"text":"Downtown exit: lanes 6 and 7 on the right.","item":"x-dt","dest":0,"lat":25.19135,"lng":55.26724},{"text":"Arrive in Downtown Dubai.","item":null,"dest":0,"lat":25.197,"lng":55.272}]}]};

/* ===== app ===== */
/* Dubai Streets Guide PRO — map engine, lane guidance, GPS, voice, offline sync */
(function () {
  'use strict';
  const C = window.APP_CONFIG, API = window.RoadsAPI;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };
  const S = { api: null, map: null, tile: null, markers: [], roadLayers: [], salik: [], filter: 'all', toggles: {}, theme: store.get('dsg-theme') || 'night',
    voice: store.get('dsg-voice') !== '0', sel: null, selRing: null, destIdx: 0, me: null, meMarker: null, watch: null, announced: new Set(), sim: null, simTimer: null };

  const ICON = { exit: '🛣️', gate: '🚪', ra: '⭕', gas: '⛽', uturn: '🔄', salik: '🚧', split: '⇆', hub: '📍', metro: '🚇' };
  const MINZ = { ra: 15, gate: 14, hub: 14, metro: 14, gas: 13, uturn: 13 };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- boot ---------- */
  async function loadDB() {
    // Works with the full folder layout, with a flat upload (dubai-roads.json in the root), or fully offline.
    for (const u of ['./database/dubai-roads.json', './dubai-roads.json']) {
      try {
        const r = await fetch(u, { cache: 'no-cache' });
        if (!r.ok) continue;
        const t = await r.text(); const j = JSON.parse(t);
        store.set('dsg-db', t);
        return j;
      } catch (e) { /* try next */ }
    }
    const c = store.get('dsg-db');
    if (c) { try { return JSON.parse(c); } catch (e) { /* fall through */ } }
    return window.BUILTIN_DUBAI_DB;
  }

  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  function fatal(msg) {
    if ($('#fatal')) return;
    const d = document.createElement('div'); d.id = 'fatal'; d.setAttribute('role', 'alert');
    d.innerHTML = '<div>' + msg + '</div><button type="button">Retry</button>';
    d.querySelector('button').onclick = () => location.reload();
    ($('#app') || document.body).appendChild(d);
  }
  function fixSize() { if (S.map) S.map.invalidateSize(); }

  async function boot() {
    if (!window.L) { fatal('Map library could not be loaded. The external map dependencies (unpkg.com / map tiles) were unreachable. Check your connection and retry.'); return; }
    try { initMap(); } catch (e) { fatal('The map could not start: ' + esc(e.message)); return; }
    // iOS dynamic viewports settle late: re-measure the container several times.
    setTimeout(fixSize, 100); setTimeout(fixSize, 500); setTimeout(fixSize, 1500);
    window.addEventListener('resize', fixSize);
    window.addEventListener('orientationchange', () => setTimeout(fixSize, 300));
    S.api = API.create(await loadDB());
    drawRoads(); drawZones(); drawMarkers(); bindUI(); renderList(); applyTheme(); renderFuel(); renderRibbon(); renderSalikTable();
    setInterval(() => { refreshSalik(); renderSalikTable(); }, 60000);
    const qf = new URLSearchParams(location.search).get('filter');
    if (qf) { const p = document.querySelector('#pills .pill[data-f="' + qf + '"]'); if (p) p.click(); }
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./service-worker.js?v=3').catch(() => {});
  }

  /* ---------- map ---------- */
  function initMap() {
    S.map = L.map('map', { zoomControl: false, center: C.center, zoom: C.zoom.default, maxZoom: 19, tap: true });
    setTiles();
    S.map.on('click', () => { if (S.sheetSnap !== 'peek') snap('peek'); });
    S.map.on('zoomend', () => { if (S.filter === 'all') drawMarkers(); });
  }
  function tileLayer(def, subs) {
    return L.tileLayer(def.url, { attribution: def.attr, subdomains: subs, maxZoom: 19, className: def.cls || '' });
  }
  function setTiles() {
    if (S.tile) S.map.removeLayer(S.tile);
    const t = C.tiles[S.theme === 'night' ? 'night' : 'day'];
    let errs = 0;
    S.tile = tileLayer(t, 'abcd').addTo(S.map);
    S.tile.on('tileerror', () => {
      if (++errs === 10) { // CARTO unreachable: fall back to standard OpenStreetMap tiles (same night filter)
        S.map.removeLayer(S.tile);
        S.tile = tileLayer({ url: C.tiles.fallback.url, attr: C.tiles.fallback.attr, cls: t.cls }, 'abc').addTo(S.map);
      }
    });
  }

  function drawRoads() {
    S.roadLayers.forEach((l) => S.map.removeLayer(l)); S.roadLayers = [];
    S.api.db.roads.forEach((r) => {
      const col = C.roadColors[r.type] || C.roadColors.highway;
      const w = r.type === 'highway' ? 6 : 4;
      const glow = L.polyline(r.coords, { color: col, weight: w + 8, opacity: .22, lineCap: 'round' }).addTo(S.map);
      const opts = { color: col, weight: w, opacity: .95, lineCap: 'round' };
      if (r.type === 'loop') opts.dashArray = '8 8';
      if (r.type === 'flyover') { S.roadLayers.push(L.polyline(r.coords, { color: '#000', weight: w + 5, opacity: .4 }).addTo(S.map)); }
      const line = L.polyline(r.coords, opts).addTo(S.map).bindTooltip(r.name + ' · ' + r.limit + ' km/h', { sticky: true });
      S.roadLayers.push(glow, line);
    });
  }
  function drawZones() {
    (S.api.db.zones || []).forEach((z) => {
      L.polygon(z.coords, { color: z.color, weight: 2, fillColor: z.color, fillOpacity: .12, dashArray: '4 6' }).addTo(S.map).bindTooltip(z.name);
    });
  }

  /* ---------- markers ---------- */
  function icon(html, cls) { return L.divIcon({ html, className: 'mk ' + (cls || ''), iconSize: [0, 0] }); }
  function offsetPoint(lat, lng, headingDeg, meters) {
    const h = headingDeg * Math.PI / 180;
    return [lat + (Math.cos(h) * meters) / 111320, lng + (Math.sin(h) * meters) / (111320 * Math.cos(lat * Math.PI / 180))];
  }
  function markerFor(it) {
    const mk = [];
    let ic;
    if (it.cat === 'gas') {
      ic = icon(`<div class="gpill ${esc(it.brand.toLowerCase())}">${esc(it.brand)} <span class="arr" style="transform:rotate(${(it.entry || 0) - 90}deg)">➜</span></div>`);
    } else if (it.cat === 'uturn') {
      ic = icon(`<div class="dot uturn ${esc(it.type)}">⮌</div>`);
      const p = offsetPoint(it.lat, it.lng, (it.approach + 180) % 360, 140);
      mk.push(L.marker(p, { icon: icon(`<div class="chev ${esc(it.type)}" style="transform:translate(-50%,-50%) rotate(${it.approach - 90}deg)">›››</div>`), interactive: false, keyboard: false }));
    } else if (it.cat === 'exit') {
      ic = icon(`<div class="dot exit">${esc(it.exit || it.tag || "•")}</div>`);
    } else if (it.cat === 'gate') {
      ic = icon(`<div class="dot gate ${it.truck ? 'truck' : ''}"><span style="color:#fff">${esc(it.gate)}</span></div>`);
    } else if (it.cat === 'split') {
      ic = icon('<div class="dot split"><span>⇆</span></div>');
    } else if (it.cat === 'salik') {
      return [makeSalik(it)];
    } else {
      ic = icon(`<div class="dot ${it.cat}">${ICON[it.cat]}</div>`);
    }
    const m = L.marker([it.lat, it.lng], { icon: ic, title: it.name }).on('click', () => select(it.id, true));
    return [m].concat(mk);
  }
  function salikHTML(t) {
    return `<div class="salik ${t.band}"><svg width="46" height="26" viewBox="0 0 46 26"><path d="M3 26V10Q3 3 23 3t20 7v16" fill="none" stroke="#e5e7eb" stroke-width="5"/><rect x="2" y="2" width="42" height="6" rx="3" fill="#9ca3af"/></svg><b>${t.label}</b></div>`;
  }
  function makeSalik(it) {
    const m = L.marker([it.lat, it.lng], { icon: icon(salikHTML(API.salikTariff(new Date())), 'salik-mk'), title: it.name }).on('click', () => select(it.id, true));
    m._salikItem = it; S.salik.push(m);
    return m;
  }
  function refreshSalik() { const t = API.salikTariff(new Date()); S.salik.forEach((m) => m.setIcon(icon(salikHTML(t), 'salik-mk'))); }

  function passes(it) {
    const f = S.filter;
    let ok = true;
    if (f === 'gas') ok = it.cat === 'gas';
    else if (f === 'uturn') ok = it.cat === 'uturn';
    else if (f === 'hwy') ok = it.cat === 'exit' || it.cat === 'salik';
    else if (f === 'lane') ok = !!it.lanes;
    else if (f === 'jafza') ok = ['gate', 'ra'].includes(it.cat) || it.area === 'jafza' || it.cat === 'hub' && it.area === 'jafza';
    else if (f === 'salik') ok = it.cat === 'salik';
    if (ok && f === 'all' && S.map && S.map.getZoom() < (MINZ[it.cat] || 0)) ok = false;
    if (ok && it.cat === 'gas') ok = (!S.toggles.ev || it.ev) && (!S.toggles.truck || it.truck) && (!S.toggles.h24 || it.h24) && (!S.toggles.prayer || it.prayer);
    return ok;
  }
  function drawMarkers() {
    S.markers.forEach((m) => S.map.removeLayer(m)); S.markers = []; S.salik = [];
    S.api.all.filter(passes).forEach((it) => markerFor(it).forEach((m) => { m.addTo(S.map); S.markers.push(m); }));
  }

  /* ---------- selection / cards ---------- */
  const NAV = [
    ['Google Maps', '#4285f4', (ll) => 'https://www.google.com/maps/dir/?api=1&destination=' + ll],
    ['Waze', '#33ccff', (ll) => 'https://waze.com/ul?ll=' + ll + '&navigate=yes'],
    ['Apple Maps', '#d1d5db', (ll) => 'https://maps.apple.com/?daddr=' + ll + '&dirflg=d'],
    ['RTA Smart Drive', '#e11d48', () => 'https://www.rta.ae/wps/portal/rta/ae/home']
  ];
  function navBar(it) {
    const ll = it.lat + ',' + it.lng;
    return '<div class="navgrid">' + NAV.map((n) => `<a style="--c:${n[1]}" href="${n[2](ll)}" target="_blank" rel="noopener"><i></i>${n[0]}</a>`).join('') + '</div>';
  }
  const SVG = {
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
    truck: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/>',
    store: '<path d="M4 9l1-4h14l1 4M5 9v10h14V9M9 19v-6h6v6"/>',
    drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    tyre: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    mosque: '<path d="M5 20v-7a7 7 0 0 1 14 0v7M3 20h18M12 3v3"/>',
    fuel: '<path d="M5 20V5h9v15M3 20h13M14 9h3l2 2v6a1.5 1.5 0 0 1-3 0v-3"/>'
  };
  const svgIcon = (k) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[k]}</svg>`;
  const AMEN = [['h24', '24/7', 'clock'], ['ev', 'EV Charger', 'bolt'], ['truck', 'Truck lane', 'truck'], ['zoom', 'ZOOM/Oasis', 'store'], ['wash', 'Car wash', 'drop'], ['air', 'Tyre air', 'tyre'], ['prayer', 'Prayer room', 'mosque'], ['diesel', 'Diesel', 'fuel']];
  function shortName(it) {
    return it.name.replace('Jebel Ali Industrial', 'Jebel Ali Ind.').replace(/^(ADNOC|ENOC|Emarat)\s*·\s*/i, '$1 ')
      .replace('Dubai Investment Park', 'DIP').replace(/ (Northeast|Southwest)-bound/, '').replace(/ \(Exit \d+\)/, '').replace('Sheikh Zayed Rd', 'SZR');
  }
  function recoveryBox(it) {
    if (!it.recovery) return '';
    const u = S.api.getItem(it.recovery.uturn);
    return `<div class="recovery"><b>Missed your exit?</b> Do not cross solid white lines or reverse. Continue to
      <a href="#" data-goto="${esc(it.recovery.uturn)}">${esc(u ? u.name : 'next U-turn')}</a> —
      about <b>${it.recovery.km} km</b> ahead, adds ≈ <b>${it.recovery.min} min</b>. ${esc(it.recovery.how || '')}</div>`;
  }
  function cardHTML(it) {
    const b = [];
    if (it.exit) b.push(`<span class="badge exit">EXIT ${esc(it.exit)}</span>`);
    if (it.road) { const r = S.api.db.roads.find((x) => x.id === it.road); if (r) b.push(`<span class="badge">${esc(r.name)}</span>`); }
    if (it.limit) b.push(`<span class="badge warn">${it.limit} km/h</span>`);
    if (it.dir) b.push(`<span class="badge">${esc(it.dir)}</span>`);
    if (it.cat === 'uturn') b.push(`<span class="badge ${it.type === 'loop' ? 'ok' : 'warn'}">${{ loop: 'Free-flow loop', signal: 'Signalised', ra: 'Roundabout' }[it.type]}</span>`);
    const amen = it.cat === 'gas' ? '<div class="amen">' + AMEN.filter((a) => it[a[0]]).map((a) => `<span class="am">${svgIcon(a[2])}${a[1]}</span>`).join('') + '</div>' : '';
    let extra = '';
    if (it.cat === 'salik') { const t = API.salikTariff(new Date()); extra = `<p><b>Now: ${t.label}</b> (Dubai time). Peak AED 6 · Off-peak AED 4 · Free 01:00–06:00.</p>`; }
    return `<h2>${esc(it.name)}</h2><div class="ar" dir="rtl">${esc(it.ar || '')}</div><div class="badges">${b.join('')}</div>${amen}
      <div id="lane-box" class="lane-box"></div>
      ${navBar(it)}
      ${it.tip ? `<p>${esc(it.tip)}</p>` : ''}${it.how ? `<p><b>Approach:</b> ${esc(it.how)}</p>` : ''}${extra}
      ${it.confidence && it.confidence !== 'ok' ? `<p class="hint">Position is ${esc(it.confidence)} — verify on site.</p>` : ''}
      ${recoveryBox(it)}
      ${it.lanes ? '<button class="btn sm ghost" id="btn-junction">Open junction view</button>' : ''}`;
  }

  function select(id, fromMap) {
    const it = S.api.getItem(id); if (!it) return;
    S.sel = it; S.destIdx = 0;
    if (S.selRing) S.map.removeLayer(S.selRing);
    S.selRing = L.marker([it.lat, it.lng], { icon: icon('<div class="sel-ring"></div>'), interactive: false }).addTo(S.map);
    S.map.flyTo([it.lat, it.lng], Math.max(S.map.getZoom(), C.zoom.street - 1), { duration: .8 });
    const card = $('#card'); card.innerHTML = cardHTML(it); card.classList.remove('hidden');
    const gj = $('#btn-junction'); if (gj) gj.onclick = () => showJunction();
    $$('[data-goto]', card).forEach((a) => a.onclick = (e) => { e.preventDefault(); select(a.dataset.goto); });
    renderLanes(); renderRibbon(); updateGantry(it); truckBanner(it);
    $('#fuel-bar').classList.toggle('hidden', S.filter !== 'gas');
    $('#junction').classList.add('hidden');
    snap('half'); $('.s-scroll').scrollTop = 0;
  }

  /* ---------- gantry HUD ---------- */
  function arrowsFor(it, dest) {
    const total = it.lanes.total, held = new Set(dest.hold);
    const exitArrow = it.lanes.side === 'left' ? '↰' : '↱';
    const out = [];
    for (let n = 1; n <= total; n++) {
      const isHeld = held.has(n);
      const a = isHeld ? (dest.kind === 'exit' ? exitArrow : '↑') : '↑';
      out.push(isHeld ? a : `<span class="dim">${a}</span>`);
    }
    return out.join(' ');
  }
  function updateGantry(it) {
    const road = S.api.db.roads.find((r) => r.id === it.road);
    const g = $('#gantry');
    g.className = 'gantry ' + (road && road.type === 'highway' || it.cat === 'exit' ? 'green' : 'blue');
    $('#g-exit-no').textContent = it.exit || (it.gate ? 'G' + it.gate : it.cat === 'uturn' ? 'U' : it.cat === 'gas' ? '⛽' : '—');
    $('#g-en').textContent = it.name; $('#g-ar').textContent = it.ar || '';
    const keep = $('#g-keep');
    if (it.lanes) {
      const ls = API.laneState(it.lanes, S.destIdx);
      $('#g-arrows').innerHTML = arrowsFor(it, ls.dest);
      keep.textContent = 'KEEP ' + ls.keep; keep.classList.remove('hidden');
    } else { $('#g-arrows').textContent = it.cat === 'uturn' ? (it.approach_lane === 'left' ? '↰ ↰' : '↱ ↱') : '↑ ↑ ↑ ↑'; keep.classList.add('hidden'); }
    updateDist();
  }
  function updateDist() {
    const el = $('#g-dist');
    if (S.sel && S.me) {
      const d = API.distanceKm(S.me.lat, S.me.lng, S.sel.lat, S.sel.lng);
      el.textContent = d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km';
    } else el.textContent = S.sel && S.sel.limit ? S.sel.limit + ' km/h' : '—';
  }

  function fmtLanes(h) {
    const a = h.slice().sort((x, y) => x - y);
    return a.length >= 3 && a[a.length - 1] - a[0] === a.length - 1 ? a[0] + '–' + a[a.length - 1] : a.join(' & ');
  }

  /* ---------- lane visualizer ---------- */
  function renderLanes() {
    const it = S.sel, box = $('#lane-box'); if (!box) return;
    if (!it || !it.lanes) { box.innerHTML = ''; return; }
    const ls = API.laneState(it.lanes, S.destIdx), hold = ls.dest.hold, held = new Set(hold), n = it.lanes.total;
    const turn = it.lanes.side === 'left' ? '↰' : '↱';
    const edge = it.lanes.side === 'left' ? Math.min.apply(null, hold) : Math.max.apply(null, hold);
    const lanes = [];
    for (let k = 1; k <= n; k++) {
      const on = held.has(k), arrow = on && ls.dest.kind === 'exit' && k === edge ? turn : '↑';
      lanes.push(`<div class="ln ${on ? 'go' : ''}" aria-label="Lane ${k}${on ? ' keep' : ''}"><em>${arrow}</em><small>Lane ${k}</small></div>`);
    }
    const chips = it.lanes.dest.length > 1 ? '<div class="chips" id="lane-dest">' + it.lanes.dest.map((d, i) => `<button data-i="${i}" class="${i === S.destIdx ? 'active' : ''}">${esc(d.label)}</button>`).join('') + '</div>' : '';
    box.innerHTML = `<div class="lane-head"><h3>Lane guide</h3>${chips}</div><div class="lv">${lanes.join('')}</div>
      <div class="lane-legend"><b>KEEP ${ls.keep}</b> · lane${hold.length > 1 ? 's' : ''} ${fmtLanes(hold)} of ${n}${ls.dest.note ? ' · ' + esc(ls.dest.note) : ''}</div>`;
    $$('#lane-dest button', box).forEach((bt) => bt.onclick = () => {
      S.destIdx = +bt.dataset.i; renderLanes(); updateGantry(it);
      if (!$('#junction').classList.contains('hidden')) showJunction(true);
    });
  }

  /* ---------- junction SVG ---------- */
  function junctionSVG(it, destIdx) {
    const ls = API.laneState(it.lanes, destIdx), n = it.lanes.total, held = new Set(ls.dest.hold);
    const W = 360, H = 230, yb = 214, yt = 70, xbL = 40, xbR = 250, xtL = 105, xtR = 205;
    const lx = (i, y) => { const t = (yb - y) / (yb - yt); const l = xbL + (xtL - xbL) * t, r = xbR + (xtR - xbR) * t; return l + (r - l) * (i / n); };
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Lane diagram"><defs><linearGradient id="gl" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#34ff9e" stop-opacity=".95"/><stop offset="1" stop-color="#34ff9e" stop-opacity=".25"/></linearGradient></defs>`;
    // ramp branching off
    const side = it.lanes.side === 'left' ? -1 : 1;
    const rx = side > 0 ? lx(n, 130) : lx(0, 130), rx2 = side > 0 ? 335 : 15;
    s += `<polygon points="${rx},150 ${rx2},${yb} ${rx2 - side * 60},${yb} ${rx - side * 2},118" fill="#3a4540"/>`;
    s += `<polygon points="${lx(0, yb)},${yb} ${lx(n, yb)},${yb} ${lx(n, yt)},${yt} ${lx(0, yt)},${yt}" fill="#3a4540"/>`;
    for (let i = 1; i <= n; i++) if (held.has(i)) {
      const a = i - 1, b = i, ins = .12;
      s += `<polygon points="${lx(a + ins, yb - 4)},${yb - 4} ${lx(b - ins, yb - 4)},${yb - 4} ${lx(b - ins, yt + 6)},${yt + 6} ${lx(a + ins, yt + 6)},${yt + 6}" fill="url(#gl)"/>`;
      const cx = (lx(a, 150) + lx(b, 150)) / 2;
      s += `<path d="M${cx} 160 v-34 m-8 10 l8 -12 l8 12" stroke="#fff" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    for (let i = 0; i <= n; i++) {
      const edge = i === 0 || i === n;
      s += `<line x1="${lx(i, yb)}" y1="${yb}" x2="${lx(i, yt)}" y2="${yt}" stroke="#fff" stroke-width="${edge ? 3 : 2}" ${edge || i === Math.max(...ls.dest.hold) || i === Math.min(...ls.dest.hold) - 1 ? '' : 'stroke-dasharray="10 9"'}/>`;
    }
    // gantry
    const gc = it.cat === 'exit' ? C.gantry.green : C.gantry.blue;
    s += `<rect x="30" y="8" width="300" height="48" rx="5" fill="${gc}" stroke="#d1d5db" stroke-width="3"/><rect x="36" y="14" width="40" height="22" rx="3" fill="#ffd400"/><text x="56" y="31" text-anchor="middle" font-size="15" font-weight="800" fill="#111" font-family="Arial">${esc(it.exit || '→')}</text>`;
    s += `<text x="84" y="28" font-size="13" font-weight="700" fill="#fff" font-family="Arial">${esc(ls.dest.label).slice(0, 30)}</text><text x="324" y="48" text-anchor="end" font-size="11" fill="#fff" font-family="Arial">${esc(it.ar || '')}</text>`;
    s += `<line x1="60" y1="56" x2="60" y2="72" stroke="#9ca3af" stroke-width="4"/><line x1="300" y1="56" x2="300" y2="72" stroke="#9ca3af" stroke-width="4"/>`;
    s += `<text x="${W / 2}" y="${H - 2}" text-anchor="middle" font-size="9" fill="#9ca3af" font-family="Arial">Solid white = do not cross · Dashed = may change lane</text></svg>`;
    return s;
  }
  function showJunction(auto) {
    const it = S.sel; if (!it || !it.lanes) return;
    const ls = API.laneState(it.lanes, S.destIdx);
    $('#j-title').textContent = it.name + ' — ' + ls.dest.label;
    $('#j-svg').innerHTML = junctionSVG(it, S.destIdx);
    $('#j-note').textContent = `Keep ${ls.keep.toLowerCase()}: lane${ls.dest.hold.length > 1 ? 's' : ''} ${fmtLanes(ls.dest.hold)} of ${it.lanes.total}. ${ls.dest.note || ''}`;
    $('#junction').classList.remove('hidden');
    if (auto !== true) snap('peek');
  }

  /* ---------- upcoming-on-this-highway timeline ---------- */
  function renderRibbon() {
    const it = S.sel, el = $('#ribbon');
    const road = it && it.road ? it.road : 'e11';
    const items = S.api.all.filter((i) => i.road === road && i.km != null && ['exit', 'uturn', 'gas', 'gate', 'salik', 'split'].includes(i.cat)).sort((a, b) => a.km - b.km);
    const ref = S.me || { lat: C.center[0], lng: C.center[1] };
    const onRoad = it && it.road === road && it.km != null;
    el.innerHTML = items.map((i) => {
      const chip = onRoad ? (i.id === it.id ? 'You are here' : (i.km > it.km ? '➔ ' : '⬅ ') + Math.abs(i.km - it.km).toFixed(1) + ' km') : API.distanceKm(ref.lat, ref.lng, i.lat, i.lng).toFixed(1) + ' km';
      return `<div class="rb ${it && i.id === it.id ? 'cur' : ''}" data-id="${esc(i.id)}"><div class="rb-ic">${ICON[i.cat]}</div><div class="rb-tx"><b>${i.exit ? 'Exit ' + esc(i.exit) + ' · ' : ''}${esc(shortName(i))}</b><span class="dchip">${chip}</span></div></div>`;
    }).join('') || '<div class="hint">No mapped stops on this road.</div>';
    $$('.rb', el).forEach((n) => n.onclick = () => select(n.dataset.id));
    const cur = $('.rb.cur', el); if (cur) el.scrollLeft = Math.max(0, cur.offsetLeft - 12);
  }

  function renderSalikTable() {
    const s = C.salik, now = API.salikTariff(new Date()).band;
    const rows = [['peak', 'Peak · Mon–Sat 06–10 &amp; 16–20', 'AED ' + s.peak], ['offpeak', 'Off-peak · 10–16, 20–01 &amp; all day Sunday', 'AED ' + s.offPeak], ['free', 'Late night · every day 01–06', 'FREE']];
    const t = $('#salik-tbl'); if (t) t.innerHTML = rows.map((r) => `<tr class="${r[0] === now ? 'now' : ''}"><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
  }

  /* ---------- fuel / list / search ---------- */
  function renderFuel() {
    const f = C.fuel;
    $('#fuel-asof').textContent = f.asOf;
    $('#fuel-prices').innerHTML = [['Super 98', f.super98], ['Special 95', f.special95], ['E-Plus 91', f.eplus91], ['Diesel', f.diesel]].map((p) => `<div>${p[0]}<b>${p[1].toFixed(2)}</b>AED/L</div>`).join('');
  }
  function renderList() {
    const items = S.api.all.filter(passes);
    const ref = S.me || { lat: C.center[0], lng: C.center[1] };
    items.forEach((i) => i._d = API.distanceKm(ref.lat, ref.lng, i.lat, i.lng));
    items.sort((a, b) => a._d - b._d);
    $('#list').innerHTML = items.slice(0, 40).map((i) => `<div class="item" data-id="${esc(i.id)}"><div class="ic">${ICON[i.cat]}</div><div class="tx"><b>${i.exit ? 'Exit ' + esc(i.exit) + ' · ' : ''}${esc(i.name)}</b><span>${esc(i.ar || '')}</span></div><span>${i._d.toFixed(1)} km</span></div>`).join('');
    $$('#list .item').forEach((n) => n.onclick = () => select(n.dataset.id));
  }
  function truckBanner(it) {
    const el = $('#truck-banner');
    const heavy = ['e311', 'e611'].includes(it.road) || it.area === 'industrial' || it.cat === 'gate' && it.truck;
    if (!heavy) { el.classList.add('hidden'); return; }
    const now = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    const active = C.truck.windows.some((w) => now >= w[0] && now < w[1]);
    el.className = 'truck' + (active ? ' active' : '');
    el.innerHTML = `🚛 <b>Heavy trucks:</b> ${active ? 'peak-hour restriction window now' : 'outside the usual restriction windows'} (${C.truck.windows.map((w) => w.join('–')).join(' & ')}). <span class="hint">${esc(C.truck.note)}</span>`;
  }
  function bindSearch() {
    const q = $('#q'), box = $('#suggest');
    q.addEventListener('input', () => {
      const r = S.api.search(q.value);
      box.innerHTML = r.map((i) => `<li data-id="${esc(i.id)}">${ICON[i.cat]} ${esc(i.name)}<small>${esc(i.ar || '')}</small></li>`).join('');
      box.classList.toggle('hidden', !r.length);
      $$('li', box).forEach((li) => li.onclick = () => { box.classList.add('hidden'); q.value = ''; select(li.dataset.id); });
    });
    q.addEventListener('focus', () => snap('half'));
  }

  /* ---------- bottom sheet ---------- */
  function snap(s) { S.sheetSnap = s; $('#sheet').dataset.snap = s; document.body.dataset.sheet = s; }
  function bindSheet() {
    const sheet = $('#sheet'), h = $('#handle'); let y0 = 0, base = 0, moved = false;
    const vh = () => window.innerHeight;
    const pos = { peek: () => vh() * .85 - 120, half: () => vh() * .85 - vh() * .45, full: () => 0 };
    h.addEventListener('pointerdown', (e) => { h.setPointerCapture(e.pointerId); y0 = e.clientY; base = pos[S.sheetSnap || 'peek'](); sheet.classList.add('dragging'); moved = false; });
    h.addEventListener('pointermove', (e) => { if (!sheet.classList.contains('dragging')) return; moved = true; const y = Math.max(0, Math.min(pos.peek(), base + e.clientY - y0)); sheet.style.transform = `translateY(${y}px)`; });
    const end = (e) => {
      if (!sheet.classList.contains('dragging')) return;
      sheet.classList.remove('dragging');
      const y = base + e.clientY - y0; sheet.style.transform = '';
      if (!moved) { snap(S.sheetSnap === 'peek' ? 'half' : 'peek'); return; }
      const c = ['peek', 'half', 'full'].sort((a, b) => Math.abs(pos[a]() - y) - Math.abs(pos[b]() - y))[0];
      snap(c);
    };
    h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
    snap('peek');
  }

  /* ---------- theme / voice ---------- */
  function applyTheme() {
    document.documentElement.dataset.theme = S.theme;
    $('#b-theme').textContent = S.theme === 'night' ? '☾' : '☀';
    document.querySelector('meta[name="theme-color"]').content = C.themes[S.theme].bg;
    setTiles();
  }
  function speak(t) {
    if (!S.voice || !('speechSynthesis' in window)) return;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'en-GB'; u.rate = .95; speechSynthesis.speak(u); } catch (e) { /* ignore */ }
  }
  function alertBar(msg, info) { const a = $('#alert-bar'); a.textContent = msg; a.className = 'alert-bar' + (info ? ' info' : ''); clearTimeout(alertBar.t); alertBar.t = setTimeout(() => a.classList.add('hidden'), 8000); }

  /* ---------- GPS ---------- */
  function locate() {
    if (!navigator.geolocation) { alertBar('Geolocation not available in this browser.'); return; }
    if (S.watch != null) { navigator.geolocation.clearWatch(S.watch); S.watch = null; $('#b-locate').classList.remove('on'); return; }
    $('#b-locate').classList.add('on');
    let first = true;
    S.watch = navigator.geolocation.watchPosition((p) => {
      S.me = { lat: p.coords.latitude, lng: p.coords.longitude, speed: p.coords.speed == null ? null : p.coords.speed * 3.6, heading: p.coords.heading };
      if (!S.meMarker) S.meMarker = L.marker([S.me.lat, S.me.lng], { icon: icon('<div class="me"></div>'), interactive: false, zIndexOffset: 1000 }).addTo(S.map);
      else S.meMarker.setLatLng([S.me.lat, S.me.lng]);
      if (first) { S.map.flyTo([S.me.lat, S.me.lng], 15); renderList(); first = false; }
      onPosition();
    }, (e) => { alertBar('GPS: ' + e.message); $('#b-locate').classList.remove('on'); S.watch = null; }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  }
  function onPosition() {
    const me = S.me;
    const near = S.api.nearestRoad(me.lat, me.lng);
    const limit = near && near.distKm < 1.5 ? near.road.limit : C.defaultLimit;
    const inAD = me.lng < C.borderLng;
    const buf = inAD ? C.radarBuffer.abuDhabi : C.radarBuffer.dubai;
    $('#sp-limit').textContent = limit; $('#sp-radar').textContent = limit + buf;
    const spd = me.speed == null ? 0 : Math.round(me.speed);
    $('#sp-cur').textContent = spd; $('#speedo').classList.toggle('over', spd > limit);
    if (inAD && !S.announced.has('ad')) { S.announced.add('ad'); alertBar('Entering Abu Dhabi: the Dubai radar tolerance does not apply. Stay at or below the posted limit.'); speak('Entering Abu Dhabi. Keep to the posted speed limit.'); }
    if (!inAD) S.announced.delete('ad');
    // approaching exits / splits ahead (within 800 m)
    S.api.all.filter((i) => i.lanes).forEach((i) => {
      const d = API.distanceKm(me.lat, me.lng, i.lat, i.lng) * 1000;
      if (d < 800 && !S.announced.has(i.id)) {
        S.announced.add(i.id); select(i.id); showJunction(true); const ls = API.laneState(i.lanes, 0);
        speak(`In ${Math.round(d / 100) * 100} metres, ${i.exit ? 'exit ' + i.exit + ', ' : ''}${i.name}. Keep ${ls.keep.toLowerCase()}.`);
      } else if (d > 1500) S.announced.delete(i.id);
    });
    updateDist();
  }

  /* ---------- route simulator ---------- */
  function bindRoute() {
    const pick = $('#route-pick');
    pick.innerHTML = S.api.db.routes.map((r, i) => `<option value="${i}">${esc(r.name)}</option>`).join('');
    const draw = () => { const r = S.api.db.routes[+pick.value]; $('#route-steps').innerHTML = r.steps.map((s, i) => `<li data-i="${i}">${esc(s.text)}</li>`).join(''); };
    pick.onchange = draw; draw();
    $('#route-go').onclick = () => {
      stopSim(); const r = S.api.db.routes[+pick.value]; let i = 0; $('#m-route').classList.add('hidden'); snap('peek');
      const poly = L.polyline(r.steps.map((s) => [s.lat, s.lng]), { color: '#fbbf24', weight: 6, opacity: .8 }).addTo(S.map); S.map.fitBounds(poly.getBounds(), { padding: [40, 40] });
      S.sim = { poly, marker: L.marker([r.steps[0].lat, r.steps[0].lng], { icon: icon('<div class="me"></div>'), interactive: false }).addTo(S.map) };
      $('#turns').innerHTML = r.steps.map((s, k) => `<li data-k="${k}">${esc(s.text)}</li>`).join(''); $('#turns-blk').classList.remove('hidden');
      const step = () => {
        if (i >= r.steps.length) { stopSim(true); return; }
        const s = r.steps[i++]; S.sim.marker.setLatLng([s.lat, s.lng]); S.map.panTo([s.lat, s.lng]);
        if (s.item) { S.sel = S.api.getItem(s.item); S.destIdx = s.dest || 0; if (S.sel) updateGantry(S.sel); }
        alertBar(s.text, true); speak(s.text);
        $$('#route-steps li').forEach((li) => li.classList.toggle('cur', +li.dataset.i === i - 1));
        $$('#turns li').forEach((li) => li.classList.toggle('cur', +li.dataset.k === i - 1));
      };
      step(); S.simTimer = setInterval(step, 6500);
    };
    $('#route-stop').onclick = () => stopSim();
  }
  function stopSim(done) {
    clearInterval(S.simTimer);
    if (S.sim) { S.map.removeLayer(S.sim.poly); S.map.removeLayer(S.sim.marker); S.sim = null; if (done) alertBar('You have arrived. Simulation finished.', true); }
  }

  /* ---------- UI wiring ---------- */
  function bindUI() {
    bindSheet(); bindSearch(); bindRoute();
    $$('#pills .pill').forEach((p) => p.onclick = () => {
      $$('#pills .pill').forEach((x) => x.classList.remove('active')); p.classList.add('active');
      S.filter = p.dataset.f; drawMarkers(); renderList();
      $('#fuel-bar').classList.toggle('hidden', S.filter !== 'gas');
      if (S.filter === 'gas') snap('half');
    });
    $$('#fuel-toggles button').forEach((b) => b.onclick = () => { S.toggles[b.dataset.t] = !S.toggles[b.dataset.t]; b.classList.toggle('active', S.toggles[b.dataset.t]); drawMarkers(); renderList(); });
    $('#b-locate').onclick = locate;
    $('#b-north').onclick = () => S.map.flyTo(S.me ? [S.me.lat, S.me.lng] : C.center, C.zoom.default);
    $('#b-tilt').onclick = (e) => { const on = $('#map-wrap').classList.toggle('tilt'); e.currentTarget.classList.toggle('on', on); };
    $('#b-theme').onclick = () => { S.theme = S.theme === 'night' ? 'day' : 'night'; store.set('dsg-theme', S.theme); applyTheme(); };
    $('#b-voice').onclick = (e) => { S.voice = !S.voice; store.set('dsg-voice', S.voice ? '1' : '0'); e.currentTarget.classList.toggle('on', S.voice); e.currentTarget.textContent = S.voice ? '🔊' : '🔇'; };
    $('#b-voice').classList.toggle('on', S.voice); $('#b-voice').textContent = S.voice ? '🔊' : '🔇';
    $('#b-route').onclick = () => $('#m-route').classList.remove('hidden');
    $('#b-deploy').onclick = () => $('#m-deploy').classList.remove('hidden');
    $$('[data-close]').forEach((b) => b.onclick = () => b.closest('.modal').classList.add('hidden'));
    $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); }));
    $('#j-close').onclick = () => $('#junction').classList.add('hidden');
    $('#gh-push').onclick = async () => {
      const log = $('#gh-log'); log.textContent = '';
      const add = (m) => { log.textContent += m + '\n'; log.scrollTop = log.scrollHeight; };
      try {
        await window.GitHubPusher.pushSiteFiles({ user: $('#gh-user').value.trim(), repo: $('#gh-repo').value.trim(), branch: $('#gh-branch').value.trim() || 'main', token: $('#gh-token').value.trim() }, add);
      } catch (e) { add('Error: ' + e.message); }
    };
  }

  ready(boot);
})();
