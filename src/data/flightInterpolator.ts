import type { FlightState } from "./opensky";

/**
 * Smooths OpenSky's ~12s snapshot updates into continuous on-screen motion,
 * keyed by icao24 rather than array position.
 *
 * deck.gl's built-in GPU `transitions` interpolate attribute buffers by
 * *index*, not identity — and OpenSky's response order isn't stable between
 * requests, plus thousands of aircraft enter/leave the bounding box every
 * poll. Any insertion or removal shifts every subsequent index, so a GPU
 * transition (even fed a sorted array) ends up tweening unrelated aircraft
 * into each other, which reads as planes teleporting at impossible speeds.
 * Interpolating here, per real aircraft identity, avoids that entirely.
 *
 * It also guards against the (rarer, but real) case where OpenSky itself
 * reports two wildly different positions for the same icao24 between polls
 * — bad receiver data or an ICAO24 address reused by a different aircraft.
 * Rather than smoothly animate an impossible multi-hundred-km/s "flight",
 * implausible jumps snap instantly instead of gliding.
 */

interface Track {
  from: { lon: number; lat: number; alt: number };
  to: { lon: number; lat: number; alt: number };
  fromTime: number;
  toTime: number;
  lastRealPos: { lon: number; lat: number };
  lastRealTime: number;
  latest: FlightState;
}

// ~1260 km/h — well above any real airliner's cruise speed, generous enough
// to never clip genuine fast movement (military jets, strong tailwinds)
// while still catching multi-hundred-km "teleports" from bad data.
const MAX_PLAUSIBLE_SPEED_KM_S = 0.35;

function shortestLon(from: number, to: number): number {
  let d = to - from;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return from + d;
}

function haversineKm(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export class FlightInterpolator {
  private tracks = new Map<string, Track>();

  /** Call once per poll with a fresh snapshot. */
  ingest(newFlights: FlightState[], durationMs: number, now: number = performance.now()) {
    const seen = new Set<string>();
    for (const f of newFlights) {
      seen.add(f.icao24);
      const to = { lon: f.longitude, lat: f.latitude, alt: f.geoAltitude ?? 0 };
      const existing = this.tracks.get(f.icao24);
      if (existing) {
        const realDtS = (now - existing.lastRealTime) / 1000;
        const distKm = haversineKm(existing.lastRealPos, to);
        const impliedSpeedKmS = realDtS > 0 ? distKm / realDtS : 0;
        if (realDtS > 0 && impliedSpeedKmS > MAX_PLAUSIBLE_SPEED_KM_S) {
          // Implausible — snap instantly rather than animate a fake flight.
          existing.from = to;
          existing.to = to;
          existing.fromTime = now;
          existing.toTime = now;
        } else {
          const cur = sampleTrack(existing, now);
          existing.from = cur;
          existing.to = { lon: shortestLon(cur.lon, to.lon), lat: to.lat, alt: to.alt };
          existing.fromTime = now;
          existing.toTime = now + durationMs;
        }
        existing.lastRealPos = to;
        existing.lastRealTime = now;
        existing.latest = f;
      } else {
        // First sighting — appear immediately at the real position, no
        // animate-in-from-nowhere.
        this.tracks.set(f.icao24, {
          from: to,
          to,
          fromTime: now,
          toTime: now,
          lastRealPos: to,
          lastRealTime: now,
          latest: f
        });
      }
    }
    for (const key of this.tracks.keys()) {
      if (!seen.has(key)) this.tracks.delete(key);
    }
  }

  /** Call every animation frame to get the current, smoothly-interpolated positions. */
  sample(now: number = performance.now()): FlightState[] {
    const out: FlightState[] = [];
    for (const track of this.tracks.values()) {
      const pos = sampleTrack(track, now);
      out.push({ ...track.latest, longitude: wrapLon(pos.lon), latitude: pos.lat, geoAltitude: pos.alt });
    }
    return out;
  }

  get size(): number {
    return this.tracks.size;
  }
}

function sampleTrack(t: Track, now: number): { lon: number; lat: number; alt: number } {
  const span = t.toTime - t.fromTime;
  const eased = span > 0 ? Math.max(0, Math.min(1, (now - t.fromTime) / span)) : 1;
  return {
    lon: t.from.lon + (t.to.lon - t.from.lon) * eased,
    lat: t.from.lat + (t.to.lat - t.from.lat) * eased,
    alt: t.from.alt + (t.to.alt - t.from.alt) * eased
  };
}

function wrapLon(lon: number): number {
  let l = lon;
  while (l > 180) l -= 360;
  while (l < -180) l += 360;
  return l;
}
