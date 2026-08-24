import maplibregl, { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// OpenFreeMap — free, keyless, CORS-enabled vector tiles (no API token needed,
// unlike Mapbox GL). https://openfreemap.org/
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function createMap(container: HTMLElement): MapLibreMap {
  const map = new maplibregl.Map({
    container,
    style: STYLE_URL,
    // Defaults roughly frame Europe, matching the dashboard's default region.
    center: [15, 48],
    zoom: 3.3,
    pitch: 0,
    canvasContextAttributes: { antialias: true },
    attributionControl: { compact: true }
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");
  // Lets the user flip between flat Web Mercator and a literal 3D globe —
  // MapLibre GL JS v5+ ships this as an explicit control rather than a
  // constructor/style option.
  map.addControl(new maplibregl.GlobeControl(), "bottom-right");

  map.on("load", () => {
    try {
      map.setSky({
        "sky-color": "#0b1020",
        "sky-horizon-blend": 0.5,
        "horizon-color": "#1a2a4a",
        "horizon-fog-blend": 0.6,
        "fog-color": "#0d0d0d",
        "fog-ground-blend": 0.5
      } as any);
    } catch {
      /* sky styling is a progressive enhancement */
    }
  });

  return map;
}
