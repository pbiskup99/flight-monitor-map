import maplibregl, { Map as MapLibreMap } from "maplibre-gl";
import type { FlightState } from "../data/opensky";

// Icons are 20-34px (see flightLayers.ts), anchored at their center, so a
// plane just outside the raw lng/lat bounds can still have part of its sprite
// on screen. Padding by a bit more than the largest icon radius avoids
// popping planes out a few pixels early. Degrees-per-pixel is derived from
// zoom (Web Mercator's standard 360 / (256 * 2^z)) rather than measured off
// the current bounds, so it's unaffected by antimeridian wrap.
const ICON_PADDING_PX = 40;

/**
 * Drops aircraft outside the current viewport before they reach deck.gl.
 * WebGL only rasterizes visible pixels either way, but for a region like
 * "Europe" (thousands of aircraft) viewed zoomed into one city, skipping the
 * attribute upload for off-screen instances is real GPU/JS work saved on
 * every rebuild. map.getBounds() is a safe superset of what's actually
 * visible under pitch, rotation, or globe projection, so this never hides a
 * plane that would otherwise be on screen — worst case it just culls less.
 */
export function cullToViewport(flights: FlightState[], map: MapLibreMap): FlightState[] {
  const bounds = map.getBounds();
  const wrapped = bounds.getWest() > bounds.getEast(); // crossing the antimeridian
  const pad = wrapped ? 0 : (360 / (256 * Math.pow(2, map.getZoom()))) * ICON_PADDING_PX;
  // Padding can push south/north past the poles (e.g. a fully zoomed-out
  // world view already sits close to Mercator's latitude limit) —
  // LngLatBounds throws on an out-of-range latitude, so clamp it.
  const south = Math.max(bounds.getSouth() - pad, -90);
  const north = Math.min(bounds.getNorth() + pad, 90);
  const padded = new maplibregl.LngLatBounds([bounds.getWest() - pad, south], [bounds.getEast() + pad, north]);
  return flights.filter((f) => padded.contains([f.longitude, f.latitude]));
}
