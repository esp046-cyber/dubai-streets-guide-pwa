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
