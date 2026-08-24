import type { Map as MapLibreMap } from "maplibre-gl";
import type { FlightState } from "../data/opensky";

export interface FlightCluster {
  // A single-flight cluster renders as the normal heading-aware plane icon.
  // 2+ means the members' icons touch or overlap on screen — too close to
  // tell apart, so they render as one direction-less cluster glyph with a
  // count badge instead.
  flights: FlightState[];
  longitude: number;
  latitude: number;
}

export function clusterIconSize(count: number): number {
  // Grows slowly with member count so a 3-plane cluster and a 300-plane
  // cluster both read as "a cluster" without the latter swallowing the map.
  // Purely cosmetic — NOT used to decide who joins a cluster (see
  // TOUCH_RADIUS_PX below for why).
  return Math.min(22 + Math.sqrt(count) * 5, 46);
}

// How close (in screen pixels) a plane has to be to an existing cluster to
// join it — roughly two 20px icons just touching edge-to-edge. Deliberately
// a FIXED radius, not derived from clusterIconSize(): an earlier version let
// a cluster's *catchment* grow with its member count (matching its bigger
// drawn bubble), which created a feedback loop — bigger cluster -> bigger
// reach -> absorbs more -> bigger still. In any reasonably busy region that
// snowballs into a single cluster swallowing nearly the entire viewport.
// Keeping the reach fixed bounds every cluster to a ~2x radius footprint
// around the plane that started it, regardless of how many aircraft end up
// in it, so dense airspace becomes many adjacent clusters rather than one
// giant blob.
const TOUCH_RADIUS_PX = 22;

// Past this zoom, individual aircraft are already meant to be inspected one
// by one (e.g. planes queued nose-to-tail on a taxiway) — clustering is
// switched off entirely so nothing ever hides behind a blob once you've
// zoomed in.
const MAX_CLUSTER_ZOOM = 12;

interface ClusterAcc {
  // Fixed at creation (the founding plane's position) — this is what bounds
  // the cluster's footprint; it deliberately never drifts as members join.
  anchorX: number;
  anchorY: number;
  sumX: number;
  sumY: number;
  flights: FlightState[];
}

/**
 * Screen-space clustering: a plane joins an existing cluster if it's within
 * TOUCH_RADIUS_PX of that cluster's anchor (its founding member's position),
 * otherwise it starts a new one. Recomputed on every rebuild from the
 * *projected pixel* positions (not lon/lat, since degrees-per-pixel varies
 * with zoom and latitude), so panning/zooming naturally reshapes clusters as
 * the same points spread apart or crowd together on screen. A grid keyed by
 * TOUCH_RADIUS_PX-sized cells keeps the anchor search near-O(1) per plane
 * instead of scanning every existing cluster.
 *
 * `keepSeparateIcao24` (the selected flight, if any) is never merged into a
 * cluster, so selecting a plane doesn't make it disappear into an anonymous
 * group and lose its highlighted/heading icon. Past MAX_CLUSTER_ZOOM,
 * clustering is skipped entirely.
 */
export function clusterFlights(
  flights: FlightState[],
  map: MapLibreMap,
  keepSeparateIcao24: string | null
): FlightCluster[] {
  const result: FlightCluster[] = [];
  const clustersEnabled = map.getZoom() < MAX_CLUSTER_ZOOM;

  const clusters: ClusterAcc[] = [];
  const grid = new Map<string, number[]>();
  const cellOf = (v: number) => Math.floor(v / TOUCH_RADIUS_PX);

  for (const f of flights) {
    if (f.icao24 === keepSeparateIcao24) {
      result.push({ flights: [f], longitude: f.longitude, latitude: f.latitude });
      continue;
    }
    if (!clustersEnabled) {
      result.push({ flights: [f], longitude: f.longitude, latitude: f.latitude });
      continue;
    }

    const { x, y } = map.project([f.longitude, f.latitude]);
    const cx = cellOf(x);
    const cy = cellOf(y);

    let target: ClusterAcc | null = null;
    for (let dx = -1; dx <= 1 && !target; dx++) {
      for (let dy = -1; dy <= 1 && !target; dy++) {
        const bucket = grid.get(`${cx + dx}:${cy + dy}`);
        if (!bucket) continue;
        for (const idx of bucket) {
          const c = clusters[idx];
          if (Math.hypot(x - c.anchorX, y - c.anchorY) <= TOUCH_RADIUS_PX) {
            target = c;
            break;
          }
        }
      }
    }

    if (target) {
      target.sumX += x;
      target.sumY += y;
      target.flights.push(f);
    } else {
      clusters.push({ anchorX: x, anchorY: y, sumX: x, sumY: y, flights: [f] });
      const key = `${cx}:${cy}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(clusters.length - 1);
      else grid.set(key, [clusters.length - 1]);
    }
  }

  for (const c of clusters) {
    if (c.flights.length === 1) {
      const f = c.flights[0];
      result.push({ flights: c.flights, longitude: f.longitude, latitude: f.latitude });
    } else {
      const n = c.flights.length;
      const center = map.unproject([c.sumX / n, c.sumY / n]);
      result.push({ flights: c.flights, longitude: center.lng, latitude: center.lat });
    }
  }

  return result;
}
