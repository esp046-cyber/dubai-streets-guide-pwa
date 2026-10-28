# Architecture

Static PWA: HTML + CSS + vanilla ES6, Leaflet over OpenStreetMap / CARTO tiles. No API keys, no build step.

```
index.html ─┬─ style.css
            ├─ config/app.config.js   settings, Salik tariff, fuel prices, theme, file list
            ├─ api/roads-api.js       pure functions + REST-like queries (browser, SW, Node)
            ├─ api/github-pusher.js   GitHub Contents API client
            └─ script.js              map engine, HUD, lane renderer, GPS, voice, simulator
database/dubai-roads.json            all roads and points (schema in database/schema.json)
service-worker.js                    precache + tile cache + offline API + offline.html fallback
```

## Data model
Categories: `roads`, `exit`, `split`, `uturn`, `gas`, `gate`, `ra`, `hub`, `metro`, `salik`, `zones`, `routes`.
Lane data: `lanes = { total, side, dest: [{ label, hold: [lane numbers, 1 = leftmost], kind: 'exit'|'through', note }] }`.
For a destination of kind `exit`, lanes not held show "THROUGH TRAFFIC"; for `through`, they show "EXIT ONLY".

## Behaviours
- **Salik badge**: `salikTariff(date)` evaluated in Asia/Dubai time, so it is right on a phone set to another time zone.
- **Speed widget**: posted limit from the nearest mapped road (within 1.5 km, else 80); radar ring = limit + 20 inside Dubai, +0 west of `borderLng`.
- **Junction auto-open**: GPS within 800 m of an item with lanes selects it, opens the junction view and speaks the instruction once.
- **Offline**: database cached in the Cache API and localStorage; tiles cached up to 400 entries.

## Updating data
Edit `database/dubai-roads.json` directly (follow `schema.json`). Update `config/app.config.js` → `fuel` each month.
Bump `VERSION` in `service-worker.js` so installed apps refresh.
