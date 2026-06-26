# AGENTS.md

## Cursor Cloud specific instructions

This is a single Vite + React + TypeScript app (`pool-game` / "Tiny Pool", an 8-ball pool game). Dependencies are installed automatically by the startup update script (`npm install`).

### Services
- **Game client (Vite dev server)** — the main product. Start with `npm run dev`; it serves at `http://localhost:5173` under the base path **`/tiny-pool/`** (open `http://localhost:5173/tiny-pool/`, not `/`). Local 2-Player mode works entirely in the browser with no backend.
- **Signaling server** — only needed for Online Multiplayer. Start with `npm run server`; it listens on `ws://localhost:8080` (override with `PORT`). The client hardcodes `ws://localhost:8080` in `src/engine/networking.ts`, so keep port 8080 for online mode. Online play also relies on external Google STUN servers for WebRTC, so it may not work fully in a sandboxed network.

### Lint / test / build (see `package.json` scripts)
- Typecheck/lint: `npx tsc --noEmit` (there is no separate ESLint config; `npm run build` runs `tsc` before `vite build`).
- Tests: `npm run test` (Vitest, jsdom). Suite covers physics, sync, table geometry, and the signaling server.
- Build: `npm run build`; preview the production build with `npm run preview`.

### Notes
- The README mentions Matter.js loaded via CDN, but the code actually bundles Rapier3D (`@dimforge/rapier3d-compat`, WASM) via npm — no CDN/internet needed for physics.
- Rapier emits a harmless "using deprecated parameters for the initialization function" stderr warning during tests; it is not an error.
