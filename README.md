# Dubai Streets Guide PRO — Jebel Ali & Greater Dubai

A free, key-less Progressive Web App for drivers: highway exits, **Keep Left / Keep Right** lane guidance on RTA-style gantry signs, U-turn slots, ADNOC / ENOC / Emarat stations, JAFZA gates and roundabouts, Salik gates with the live variable tariff, and an offline cheat-sheet.

Stack: vanilla HTML/CSS/ES6 + Leaflet + OpenStreetMap/CARTO tiles. **No build step, no API keys, no Codespaces.**

> ⚠️ **Data accuracy:** positions, exit/gate/roundabout numbers, lane counts and station details are approximate or schematic. Verify on the road and fix `database/dubai-roads.json` as you go. Road signs and RTA instructions always win. See `docs/JEBEL_ALI_ROAD_MANUAL.md`.

## Features
- RTA gantry HUD (green `#006B3F` / blue `#00529B`), exit badge, distance, animated lane arrows, KEEP LEFT/RIGHT alert
- Colour-coded roads: highway (emerald), slip/service (cyan), flyover (gold), loop (purple dashed)
- Interactive 6-lane strip, junction-view SVG drawer, "Missed your exit?" recovery card
- U-turn layer with animated approach chevrons (loop / signal / roundabout)
- Branded fuel pills, October 2026 UAE fuel prices, amenity filters (EV, truck, 24/7, prayer room)
- Salik arches with live tariff in Dubai time (AED 6 / 4 / free)
- Dual-ring speed + radar widget, Abu Dhabi border warning, voice guidance, route simulator
- Night/Day theme, 3D tilt, offline mode, Add to Home Screen, deep links to Google Maps, Waze, Apple Maps, RTA

## Flat upload (fixes "Database not reachable")
iPhone Safari cannot upload folders to GitHub. `script.js` now bundles the config, API and the full database, so the app runs with **only these 10 root files** uploaded (replace the old ones): `index.html`, `style.css`, `script.js`, `service-worker.js`, `manifest.json`, `offline.html`, `dubai-roads.json`, `favicon.ico`, `icon-192.png`, `icon-512.png`. The `config/`, `api/`, `database/` folders are optional sources. After uploading, open the site in a new Private tab once so the old service worker is replaced.

## Deploy from an iPhone only (no Codespaces, no PC)

### A. One-tap uploader (recommended)
1. In Safari on github.com: **+ → New repository**, name it `dubai-streets-guide`, tick **Add a README**, Create.
2. github.com/settings/personal-access-tokens → **Generate new token (fine-grained)** → only this repository → **Repository permissions → Contents: Read and write** → Generate. Copy the token.
3. Save the zip to **Files** and tap it once to extract.
4. Open `docs/iphone-github-uploader.html` from the extracted folder (Files → tap → Share → Open in Safari; if Safari will not run local files, use option B).
5. Enter username, repo, branch `main`, the token, choose the **.zip**, tap **Upload everything**. Wait for "Finished: 37 uploaded, 0 failed".
6. Repo **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)` → Save**. After about a minute the app is live at `https://YOUR-USERNAME.github.io/dubai-streets-guide/`.

### B. Manual upload in Safari
1. Extract the zip in Files.
2. Repo → **Add file → Upload files → Choose files → Browse** and pick everything inside the extracted folder. GitHub's mobile page uploads folders poorly, so upload the root files first, then repeat for each folder (`assets`, `api`, `config`, `database`, `docs`, `screenshots`, `tests`, `backend`). Commit.
3. Enable Pages as in step 6 above.

### C. From the live app
Once the app is online anywhere, tap 📲 in the right-hand button stack to push its own files to another repository.

### After deploying
- Replace `YOUR-USERNAME` in `index.html`, `robots.txt` and `sitemap.xml` with your GitHub username so the social preview (`og:image`) points at your site.
- On iPhone: Safari → Share → **Add to Home Screen**.
- Revoke the token at github.com/settings/tokens when finished.

## Local run
```
node backend/mock-server.js     # http://localhost:8080
node tests/app.test.js          # unit tests (also: tests/test-runner.html in a browser)
```

## Monthly upkeep
Update `fuel` in `config/app.config.js` (new UAE prices are announced at month end) and bump `VERSION` in `service-worker.js`.

## Project layout
See `docs/ARCHITECTURE.md`. MIT licence.
