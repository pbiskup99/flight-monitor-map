# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the Vite dev server (port 5173). Required for OpenSky data: the dev server itself proxies and authenticates OpenSky requests (see below), so the app degrades to demo mode without it.
- `npm run build` — production build (`vite build`, target `es2022`).
- `npm run typecheck` — `tsc -b --noEmit`. There is no separate lint script and no test suite/framework configured in this repo.
- `npm run preview` — serve the production build locally.

Before live OpenSky data will load, copy `.env.local.example` to `.env.local` and fill in `OPENSKY_CLIENT_ID`/`OPENSKY_CLIENT_SECRET` (an OpenSky "API Client" from the account's My OpenSky page). Without it the app still runs and falls back to synthetic demo flights after a few failed polls.

## Architecture

This is a client-only Vite/TS app (no backend beyond the dev-server proxy) that renders live aircraft positions on a MapLibre GL map using a deck.gl overlay, with a Three.js 3D model panel for the selected flight.

**Data flow (per poll, ~12s in the default "europe" region):** `OpenSkyPoller` (`src/data/opensky.ts`) fetches state vectors → `FlightInterpolator` (`src/data/flightInterpolator.ts`) ingests the new snapshot, keyed by `icao24` → every animation frame, `main.ts` samples the interpolator, culls off-screen aircraft (`src/map/viewportCull.ts`), clusters what's left in screen space (`src/layers/screenCluster.ts`), and rebuilds deck.gl layers (`src/layers/flightLayers.ts`) via `overlay.setProps()`.

**Why interpolation exists:** deck.gl's GPU position transitions interpolate by array *index*, not identity, and OpenSky's response order/membership isn't stable between polls (thousands of aircraft enter/leave the bbox each request). Animating naively made unrelated aircraft appear to swap positions. `FlightInterpolator` glides each real aircraft between its last two known positions using its own tween, and snaps instantly instead of animating when the implied speed between two same-`icao24` reports is physically impossible (bad data / reused ICAO24).

**Why clustering is screen-space, not geo-space:** `clusterFlights()` groups planes by *projected pixel* distance (a fixed 22px touch radius), recomputed every rebuild from current pan/zoom — not by lon/lat distance, since degrees-per-pixel varies with zoom and latitude. The touch radius deliberately does not grow with cluster size (that created a snowballing "one giant blob absorbs everything" bug in busy regions).

**Selection/picking:** click and hover are handled once, centrally, via `overlay.setProps({ onClick, onHover })` in `main.ts` — not per-layer and not via a separate `map.on('click')`. Wiring both used to double-fire and immediately clear a selection right after it was made.

**OpenSky proxy (`vite.config.ts`):** the dev server injects a middleware plugin (`openSkyProxyPlugin`) that fetches an OAuth2 client-credentials token server-side and proxies `/api/opensky/states` and `/api/opensky/flights` to the real OpenSky endpoints, attaching the bearer token. The client_id/secret live only in `.env.local` and are never sent to the browser — the client only ever calls the same-origin `/api/opensky/*` paths. This proxy only exists in dev; there is no production server in this repo.

**Module layout:**
- `src/data/` — OpenSky client + poller, position interpolation, ICAO airport code → city/country lookup (lazy-fetched `public/data/airports-min.json`), synthetic demo-flight generator (kicks in after 3 consecutive failed polls, clearly labeled in the UI, dropped the instant real data returns).
- `src/map/` — MapLibre map construction/style and viewport culling.
- `src/layers/` — deck.gl layer construction: the runtime-generated canvas icon atlas (`planeIcon.ts`, no shipped image assets), screen-space clustering, and the `IconLayer`/`TextLayer` builders.
- `src/three/` — the Three.js viewer for the selected-flight 3D panel; tries a real glTF (`opts.modelUrl`) first, falls back to a procedural low-poly mesh if unset or the fetch fails.
- `src/ui/dashboard.ts` — thin DOM-binding layer for the HUD chrome (stat tiles, toggles, region picker, flight-detail panel), kept separate so `main.ts` stays about wiring, not DOM manipulation.
- `src/main.ts` — orchestration: owns the render loop, poll → interpolate → cull → cluster → build-layers pipeline, and selection state.

## Known pitfalls

- **`maplibre-gl` is pinned to `^5.24.0` — do not bump to v6.** v6.3.0 silently breaks vector tile loading (the vector source never issues `.pbf` requests, `map.isStyleLoaded()` never becomes `true`, no error fires) and drops the default ESM export. If a maplibre-gl upgrade is ever attempted, verify vector tiles actually load (Network tab, `.pbf` requests) before committing to it.
- After bumping a large pre-bundled dependency (maplibre-gl, deck.gl, three), Vite's dep cache can serve a stale optimized bundle even after deleting `node_modules/.vite` — the running dev server process needs to be killed and restarted, not just have its cache cleared.
- OpenSky's REST API (even authenticated) rate-limits and occasionally 503s; `OpenSkyPoller` already backs off exponentially and the UI already surfaces this as a status message — this is an external-service limitation, not a bug to chase.
