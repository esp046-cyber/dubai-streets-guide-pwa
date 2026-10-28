# Backend (optional)

The app is a static site and needs **no backend**. Two optional helpers exist:

| Where | What |
|---|---|
| `service-worker.js` | Answers `/api/highways`, `/api/gas`, `/api/uturns`, `/api/lanes` from the cached database when offline. |
| `backend/mock-server.js` | Local Node server (no dependencies) serving the site plus the same routes and `/api/salik`. Run `node backend/mock-server.js`. |

## Routes
- `GET /api/highways`
- `GET /api/gas?lat=25.0&lng=55.08&limit=5&ev=1&truck=1&h24=1&prayer=1`
- `GET /api/uturns?zone=jafza` (zones: `jafza`, `jebel-ali-industrial`, `discovery-gardens`, `dip`, `szr`)
- `GET /api/lanes?id=x20&dest=0`
- `GET /api/salik` (mock server only)
