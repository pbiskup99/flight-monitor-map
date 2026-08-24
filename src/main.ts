import "./style.css";
import type { IControl } from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";

import { createMap } from "./map/mapSetup";
import { cullToViewport } from "./map/viewportCull";
import { clusterFlights, type FlightCluster } from "./layers/screenCluster";
import { buildLayers } from "./layers/flightLayers";
import { OpenSkyPoller, REGIONS, fetchFlightRoute, type FlightState, type BBox } from "./data/opensky";
import { resolveAirportLabel } from "./data/airports";
import { FlightInterpolator } from "./data/flightInterpolator";
import { generateDemoFlights, advanceDemoFlights } from "./data/demoFlights";
import { PlaneModelViewer } from "./three/planeModel";
import { Dashboard } from "./ui/dashboard";

const mapContainer = document.getElementById("map")!;
const plane3dCanvas = document.getElementById("plane3d-canvas") as HTMLCanvasElement;

// Low-poly aircraft glTF used in the "selected flight" 3D panel.
// Source: CesiumJS sample data (Apache-2.0), a widely reused glTF demo asset.
// https://github.com/CesiumGS/cesium/blob/main/Apps/SampleData/models/CesiumAir/Cesium_Air.glb
const PLANE_MODEL_URL = "/models/Cesium_Air.glb";

const dashboard = new Dashboard();
dashboard.setLoading(true, "Connecting to OpenSky Network…");

const map = createMap(mapContainer);
const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
map.addControl(overlay as unknown as IControl);

const planeViewer = new PlaneModelViewer(plane3dCanvas);

const interpolator = new FlightInterpolator();
let flights: FlightState[] = [];
let selectedIcao24: string | null = null;
let selectedFlight: FlightState | null = null;
let hasReceivedFirstBatch = false;
let isDemoMode = false;
let routeRequestSeq = 0;
let currentRegionKey = "europe";
let currentBbox: BBox | null = REGIONS.europe.bbox;
let lastFleetMeta: { updatedAt: number; error: string | null } = { updatedAt: Date.now(), error: null };

function rebuildLayers() {
  const visible = cullToViewport(flights, map);
  const clusters = clusterFlights(visible, map, selectedIcao24);
  const layers = buildLayers({ clusters, toggles: dashboard.toggles, selectedIcao24 });
  overlay.setProps({ layers });
}

function selectFlight(f: FlightState) {
  selectedIcao24 = f.icao24;
  selectedFlight = f;
  dashboard.showFlight(f);
  dashboard.setRouteLoading();
  void planeViewer.showFlight(f, { modelUrl: PLANE_MODEL_URL });
  rebuildLayers();
  void loadRoute(f);
}

function clearSelection() {
  if (!selectedIcao24) return;
  selectedIcao24 = null;
  selectedFlight = null;
  routeRequestSeq++; // invalidate any in-flight route lookup
  dashboard.clearFlight();
  planeViewer.clear();
  rebuildLayers();
}

dashboard.onDeselect = clearSelection;

// Fired once per selection rather than per poll — /flights/aircraft is a
// separate, slower, more rate-limited OpenSky endpoint than the state
// vectors we already poll continuously.
async function loadRoute(f: FlightState) {
  const seq = ++routeRequestSeq;
  const route = await fetchFlightRoute(f.icao24, f.lastContact).catch(() => null);
  if (seq !== routeRequestSeq || selectedIcao24 !== f.icao24) return; // stale or deselected

  const [from, to] = await Promise.all([
    route?.departureAirport ? resolveAirportLabel(route.departureAirport) : Promise.resolve(null),
    route?.arrivalAirport ? resolveAirportLabel(route.arrivalAirport) : Promise.resolve(null)
  ]);
  if (seq !== routeRequestSeq || selectedIcao24 !== f.icao24) return; // stale or deselected

  dashboard.setRoute(from, to);
}

// A single pick handler for the whole overlay, rather than the IconLayer's
// own onClick *plus* a separate map.on('click') for "clicked empty space".
// Those two used to fire independently for the same physical click (deck.gl
// doesn't suppress MapLibre's own click event when it gets a hit) — so a
// click on a plane would select it and then immediately get cleared right
// back out by the map's handler, and only "won" on a lucky double-click.
// One handler, reading deck.gl's own pick result, has no such race.
overlay.setProps({
  onClick: (info) => {
    const c = info.object as FlightCluster | undefined;
    if (!c) {
      clearSelection();
      return;
    }
    if (c.flights.length === 1) {
      selectFlight(c.flights[0]);
    } else {
      // Clusters aren't individually selectable — zoom in on the group
      // instead, which spreads its members apart in screen space and lets
      // clusterFlights() dissolve it back into pickable individual planes.
      map.easeTo({ center: [c.longitude, c.latitude], zoom: Math.min(map.getZoom() + 3, 14), duration: 600 });
    }
  },
  onHover: (info) => {
    mapContainer.style.cursor = info.object ? "pointer" : "";
  }
});

const DEMO_MODE_THRESHOLD = 3;

const opensky = new OpenSkyPoller();
let failedAttempts = 0;
opensky.onUpdate((newFlights, meta) => {
  if (newFlights) {
    failedAttempts = 0;
    // Feed the raw snapshot to the interpolator (keyed by icao24) rather
    // than rendering it directly — see FlightInterpolator for why. The
    // glide duration is timed to roughly finish just before the next poll
    // lands, so motion reads as continuous rather than dart-then-freeze.
    const transitionDurationMs = Math.round((REGIONS[currentRegionKey]?.pollMs ?? 12000) * 0.95);
    interpolator.ingest(newFlights, transitionDurationMs);
    flights = interpolator.sample();
    if (isDemoMode) {
      isDemoMode = false;
      dashboard.setDemoMode(false);
    }
    if (selectedIcao24) {
      const still = flights.find((f) => f.icao24 === selectedIcao24);
      if (still) {
        selectedFlight = still;
        dashboard.showFlight(still);
      }
    }
    rebuildLayers();
    if (!hasReceivedFirstBatch) {
      hasReceivedFirstBatch = true;
      dashboard.setLoading(false);
    }
  } else if (!hasReceivedFirstBatch) {
    failedAttempts++;
    if (failedAttempts >= DEMO_MODE_THRESHOLD) {
      if (!isDemoMode) {
        isDemoMode = true;
        flights = generateDemoFlights(currentBbox);
        rebuildLayers();
      }
      dashboard.setDemoMode(true);
    } else {
      dashboard.setLoading(
        true,
        failedAttempts >= 2
          ? "OpenSky Network temporarily unavailable (limit/503) — retrying…"
          : "Connecting to OpenSky Network…"
      );
    }
  }
  lastFleetMeta = meta;
  dashboard.updateFleetStats(flights.length, meta.updatedAt, isDemoMode ? null : meta.error);
});
opensky.start();

dashboard.onRegionChange = (region) => {
  opensky.setRegion(region);
  currentRegionKey = region;
  const bbox = REGIONS[region]?.bbox ?? null;
  currentBbox = bbox;
  if (isDemoMode) {
    flights = generateDemoFlights(currentBbox);
    rebuildLayers();
  }
  if (bbox) {
    map.fitBounds(
      [
        [bbox.lomin, bbox.lamin],
        [bbox.lomax, bbox.lamax]
      ],
      { padding: 40, duration: 1200 }
    );
  } else {
    map.flyTo({ center: [10, 30], zoom: 2.2, duration: 1200 });
  }
};

dashboard.onToggleChange = () => {
  rebuildLayers();
};

// ---------------------------------------------------------------- resizing
function resizeAll() {
  planeViewer.resize();
}
window.addEventListener("resize", resizeAll);
resizeAll();

// ------------------------------------------------------------- render loop
let lastFrame = performance.now();
let fpsAccumulator = 0;
let fpsFrames = 0;
let lastStatsFlush = performance.now();
let lastFlightsRebuild = 0;
// Re-sampling and rebuilding layers at ~8/s rather than every rAF tick
// (60/s) is still smooth for real aircraft speeds and considerably cheaper.
const FLIGHTS_REBUILD_INTERVAL_MS = 120;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = now - lastFrame;
  lastFrame = now;
  fpsAccumulator += dt;
  fpsFrames++;

  if (isDemoMode) {
    if (now - lastStatsFlush > 500) {
      flights = advanceDemoFlights(currentBbox, (now - lastStatsFlush) / 1000);
      rebuildLayers();
    }
  } else if (interpolator.size > 0 && now - lastFlightsRebuild > FLIGHTS_REBUILD_INTERVAL_MS) {
    // Re-sample periodically so aircraft glide continuously between polls
    // instead of jumping once per ~12s update (see the interval comment
    // above for why this isn't just "every frame").
    flights = interpolator.sample(now);
    rebuildLayers();
    lastFlightsRebuild = now;
  }

  if (now - lastStatsFlush > 500) {
    const fps = (fpsFrames * 1000) / fpsAccumulator;
    dashboard.updateFps(fps);
    dashboard.updateFleetStats(
      flights.length,
      isDemoMode ? Date.now() : lastFleetMeta.updatedAt,
      isDemoMode ? null : lastFleetMeta.error
    );
    fpsAccumulator = 0;
    fpsFrames = 0;
    lastStatsFlush = now;
  }
}
requestAnimationFrame(frame);

// Handy for debugging in the devtools console.
(window as any).__map = map;
