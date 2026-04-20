# CCT Odds

Backend:

- runs on `http://localhost:9902`
- accepts GSI POSTs at `http://localhost:9902/gsi/input`
- exposes a WebSocket at `ws://localhost:9902/ws`
- serves the built React frontend from `frontend/dist`

Frontend:

- lives in `frontend/`
- React + Vite + SCSS
- routes:
  - `/control-center`
  - `/live-odds`

Important files:

- backend: `src/server.ts`
- shared backend socket types: `src/shared/protocol.ts`
- frontend app: `frontend/src/`

Run backend:

```bash
npm install
npm run dev
```

Run frontend during development:

```bash
cd frontend
npm install
npm run dev
```

Build frontend for the backend to serve:

```bash
cd frontend
npm run build
```
