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
    try {
      const r = await fetch('database/dubai-roads.json');
      if (!r.ok) throw new Error(r.status);
      const t = await r.text();
      store.set('dsg-db', t);
      return JSON.parse(t);
    } catch (e) {
      const c = store.get('dsg-db');
      if (c) return JSON.parse(c);
      throw e;
    }
  }

  async function boot() {
    try { S.api = API.create(await loadDB()); }
    catch (e) { $('#g-en').textContent = 'Database not reachable — open offline.html'; return; }
    initMap(); drawRoads(); drawZones(); drawMarkers(); bindUI(); renderList(); applyTheme(); renderFuel();
    setInterval(refreshSalik, 60000);
    const qf = new URLSearchParams(location.search).get('filter');
    if (qf) { const p = document.querySelector('#pills .pill[data-f="' + qf + '"]'); if (p) p.click(); }
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }

  /* ---------- map ---------- */
  function initMap() {
    S.map = L.map('map', { zoomControl: false, center: C.center, zoom: C.zoom.default, maxZoom: 19, tap: true });
    setTiles();
    S.map.on('click', () => { if (S.sheetSnap !== 'peek') snap('peek'); });
    S.map.on('zoomend', () => { if (S.filter === 'all') drawMarkers(); });
  }
  function setTiles() {
    if (S.tile) S.map.removeLayer(S.tile);
    const t = C.tiles[S.theme === 'night' ? 'night' : 'day'];
    S.tile = L.tileLayer(t.url, { attribution: t.attr, subdomains: 'abcd', maxZoom: 19 }).addTo(S.map);
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
  function navBar(it) {
    const ll = it.lat + ',' + it.lng;
    return `<div class="navbar">
      <a href="https://www.google.com/maps/dir/?api=1&destination=${ll}" target="_blank" rel="noopener">Google Maps</a>
      <a class="waze" href="https://waze.com/ul?ll=${ll}&navigate=yes" target="_blank" rel="noopener">Waze</a>
      <a class="apple" href="https://maps.apple.com/?daddr=${ll}&dirflg=d" target="_blank" rel="noopener">Apple Maps</a>
      <a class="rta" href="https://www.rta.ae/wps/portal/rta/ae/home" target="_blank" rel="noopener">RTA Smart Drive</a></div>`;
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
    if (it.cat === 'gas') ['h24:24/7', 'ev:⚡ EV', 'truck:🚛 Truck lane', 'zoom:🏪 ZOOM/Oasis', 'wash:🚿 Car wash', 'air:🛞 Tyre air', 'prayer:🕌 Prayer room']
      .forEach((p) => { const [k, l] = p.split(':'); if (it[k]) b.push(`<span class="badge ok">${l}</span>`); });
    if (it.cat === 'gas') b.push(`<span class="badge">Super 98 · Special 95${it.diesel ? ' · Diesel' : ''}</span>`);
    let extra = '';
    if (it.cat === 'salik') { const t = API.salikTariff(new Date()); extra = `<p><b>Now: ${t.label}</b> (Dubai time). Peak AED 6 · Off-peak AED 4 · Free 01:00–06:00.</p>`; }
    return `<h2>${esc(it.name)}</h2><div class="ar" dir="rtl">${esc(it.ar || '')}</div>${b.join('')}
      ${it.tip ? `<p>${esc(it.tip)}</p>` : ''}${it.how ? `<p><b>Approach:</b> ${esc(it.how)}</p>` : ''}${extra}
      ${it.confidence && it.confidence !== 'ok' ? `<p class="hint">Position is ${esc(it.confidence)} — verify on site.</p>` : ''}
      ${recoveryBox(it)}
      ${it.lanes ? '<button class="btn" id="btn-junction">Junction view</button>' : ''}${navBar(it)}`;
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
    snap(fromMap ? 'half' : 'half');
    if (it.lanes) showJunction(true);
    else $('#junction').classList.add('hidden');
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

  /* ---------- lane strip ---------- */
  function renderLanes() {
    const it = S.sel, strip = $('#lane-strip'), chips = $('#lane-dest');
    if (!it || !it.lanes) { chips.innerHTML = ''; strip.innerHTML = '<div class="hint">No lane data for this point.</div>'; return; }
    chips.innerHTML = it.lanes.dest.map((d, i) => `<button data-i="${i}" class="${i === S.destIdx ? 'active' : ''}">${esc(d.label)}</button>`).join('');
    $$('button', chips).forEach((b) => b.onclick = () => { S.destIdx = +b.dataset.i; renderLanes(); updateGantry(it); if (!$('#junction').classList.contains('hidden')) showJunction(true); });
    const ls = API.laneState(it.lanes, S.destIdx);
    strip.innerHTML = ls.lanes.map((l) => `<div class="lane ${l.state}"><span class="n">${l.n}</span>${l.label}</div>`).join('');
    strip.insertAdjacentHTML('afterend', '');
    let note = $('#lane-note'); if (!note) { note = document.createElement('div'); note.id = 'lane-note'; note.className = 'lane-note'; strip.after(note); }
    note.innerHTML = `<b>KEEP ${ls.keep}</b> — lane${ls.dest.hold.length > 1 ? 's' : ''} ${fmtLanes(ls.dest.hold)} (lane 1 is the far left). ${esc(ls.dest.note || '')}`;
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

  /* ---------- ribbon ---------- */
  function renderRibbon() {
    const it = S.sel, el = $('#ribbon');
    if (!it || !it.road) { el.innerHTML = '<div class="hint">This point is not on a mapped highway.</div>'; return; }
    const items = S.api.all.filter((i) => i.road === it.road && ['exit', 'uturn', 'gas', 'gate', 'salik', 'split'].includes(i.cat)).sort((a, b) => a.km - b.km);
    el.innerHTML = items.map((i) => {
      const d = Math.abs(i.km - it.km);
      return `<div class="rb ${i.id === it.id ? 'cur' : ''}" data-id="${esc(i.id)}"><i>${ICON[i.cat]}</i><b>${i.exit ? 'Exit ' + esc(i.exit) + ' ' : ''}${esc(i.name).slice(0, 22)}</b><span>${i.id === it.id ? 'You are here' : (i.km > it.km ? '➔ ' : '⬅ ') + d.toFixed(1) + ' km'}</span></div>`;
    }).join('');
    $$('.rb', el).forEach((n) => n.onclick = () => select(n.dataset.id));
    const cur = $('.rb.cur', el); if (cur) el.scrollLeft = cur.offsetLeft - el.clientWidth / 2 + 60;
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
    const pos = { peek: () => vh() * .86 - 128, half: () => vh() * .86 - vh() * .52, full: () => 0 };
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
        S.announced.add(i.id); select(i.id); const ls = API.laneState(i.lanes, 0);
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
      const step = () => {
        if (i >= r.steps.length) { stopSim(true); return; }
        const s = r.steps[i++]; S.sim.marker.setLatLng([s.lat, s.lng]); S.map.panTo([s.lat, s.lng]);
        if (s.item) { S.sel = S.api.getItem(s.item); S.destIdx = s.dest || 0; if (S.sel) updateGantry(S.sel); }
        alertBar(s.text, true); speak(s.text);
        $$('#route-steps li').forEach((li) => li.classList.toggle('cur', +li.dataset.i === i - 1));
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

  boot();
})();
