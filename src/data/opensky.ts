/**
 * OpenSky Network client — live ADS-B derived flight states.
 * https://openskynetwork.github.io/opensky-api/rest.html
 *
 * Requests go through the same-origin dev proxy at `/api/opensky/states`
 * (see vite.config.ts) rather than opensky-network.org directly. That proxy
 * attaches an OAuth2 bearer token obtained server-side from an OpenSky "API
 * Client" (client_id/client_secret in .env.local, never shipped to the
 * browser) — authenticated requests get a much higher rate limit than
 * anonymous ones, and the query is same-origin so there's no CORS
 * back-and-forth either. We still keep the region/bbox picker and backoff
 * logic below, since even the authenticated limit isn't unlimited.
 */

export interface FlightState {
  icao24: string;
  callsign: string;
  originCountry: string;
  longitude: number;
  latitude: number;
  baroAltitude: number | null;
  onGround: boolean;
  velocity: number | null; // m/s
  trueTrack: number | null; // degrees, 0 = north, clockwise
  verticalRate: number | null; // m/s
  geoAltitude: number | null;
  lastContact: number;
}

export interface BBox {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}

export const REGIONS: Record<string, { label: string; bbox: BBox | null; pollMs: number }> = {
  world: { label: "World", bbox: null, pollMs: 25000 },
  europe: { label: "Europe", bbox: { lamin: 34, lomin: -11, lamax: 71, lomax: 40 }, pollMs: 12000 },
  poland: { label: "Poland", bbox: { lamin: 49, lomin: 14, lamax: 55, lomax: 24.2 }, pollMs: 12000 },
  us: { label: "North America", bbox: { lamin: 24, lomin: -125, lamax: 50, lomax: -66 }, pollMs: 12000 },
  asia: { label: "East Asia", bbox: { lamin: 18, lomin: 100, lamax: 46, lomax: 146 }, pollMs: 12000 }
};

const STATES_URL = "/api/opensky/states";

// Raw OpenSky state vector column indices (see REST docs).
const IDX = {
  icao24: 0,
  callsign: 1,
  originCountry: 2,
  timePosition: 3,
  lastContact: 4,
  longitude: 5,
  latitude: 6,
  baroAltitude: 7,
  onGround: 8,
  velocity: 9,
  trueTrack: 10,
  verticalRate: 11,
  geoAltitude: 13
} as const;

function parseState(raw: any[]): FlightState | null {
  const lon = raw[IDX.longitude];
  const lat = raw[IDX.latitude];
  if (typeof lon !== "number" || typeof lat !== "number") return null;
  return {
    icao24: raw[IDX.icao24],
    callsign: (raw[IDX.callsign] ?? "").trim() || "—",
    originCountry: raw[IDX.originCountry] ?? "?",
    longitude: lon,
    latitude: lat,
    baroAltitude: raw[IDX.baroAltitude],
    onGround: !!raw[IDX.onGround],
    velocity: raw[IDX.velocity],
    trueTrack: raw[IDX.trueTrack],
    verticalRate: raw[IDX.verticalRate],
    geoAltitude: raw[IDX.geoAltitude],
    lastContact: raw[IDX.lastContact]
  };
}

// `flights` is null on a failed poll — listeners should keep showing the last
// good snapshot rather than clearing the map because of one dropped request.
export type FlightsListener = (
  flights: FlightState[] | null,
  meta: { updatedAt: number; error: string | null }
) => void;

export interface FlightRoute {
  departureAirport: string | null; // ICAO airport code, e.g. "EPWA"
  arrivalAirport: string | null; // null while the aircraft is still airborne — OpenSky only learns it after landing
}

const FLIGHTS_URL = "/api/opensky/flights";
const ROUTE_LOOKBACK_SECONDS = 24 * 3600;

/**
 * Looks up the aircraft's most recent flight leg via OpenSky's separate
 * `/flights/aircraft` endpoint — state vectors (used elsewhere in this file)
 * don't carry origin/destination at all, so this is a second, on-demand
 * request fired only when a flight is selected in the UI.
 */
export async function fetchFlightRoute(icao24: string, lastContact: number): Promise<FlightRoute | null> {
  const end = Math.floor(Date.now() / 1000);
  const begin = Math.min(lastContact, end) - ROUTE_LOOKBACK_SECONDS;
  const url = new URL(FLIGHTS_URL, window.location.origin);
  url.searchParams.set("icao24", icao24);
  url.searchParams.set("begin", String(begin));
  url.searchParams.set("end", String(end));

  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const json = await res.json();
  if (!Array.isArray(json) || json.length === 0) return null;

  // Entries come back ordered by time — the last one is this aircraft's
  // current (possibly still in-progress) leg.
  const last = json[json.length - 1];
  return {
    departureAirport: last.estDepartureAirport ?? null,
    arrivalAirport: last.estArrivalAirport ?? null
  };
}

export class OpenSkyPoller {
  private timer: number | null = null;
  // Anonymous OpenSky clients are aggressively rate-limited / occasionally
  // 503'd on the whole-world query, so default to a bounded region — much
  // more reliable out of the box. "world" stays selectable in the UI.
  private regionKey = "europe";
  private listeners: FlightsListener[] = [];
  private consecutiveErrors = 0;
  private inFlight = false;

  onUpdate(listener: FlightsListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  setRegion(key: string) {
    if (!REGIONS[key]) return;
    this.regionKey = key;
    this.restart();
  }

  start() {
    this.restart();
  }

  stop() {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private restart() {
    this.stop();
    void this.tick();
  }

  private scheduleNext() {
    const region = REGIONS[this.regionKey];
    // Back off exponentially (capped) after consecutive failures / 429s.
    const backoff = this.consecutiveErrors > 0 ? Math.min(2 ** this.consecutiveErrors * 5000, 120000) : 0;
    const delay = region.pollMs + backoff;
    this.timer = window.setTimeout(() => void this.tick(), delay);
  }

  private async tick() {
    if (this.inFlight) {
      this.scheduleNext();
      return;
    }
    this.inFlight = true;
    const region = REGIONS[this.regionKey];
    const url = new URL(STATES_URL, window.location.origin);
    if (region.bbox) {
      url.searchParams.set("lamin", String(region.bbox.lamin));
      url.searchParams.set("lomin", String(region.bbox.lomin));
      url.searchParams.set("lamax", String(region.bbox.lamax));
      url.searchParams.set("lomax", String(region.bbox.lomax));
    }
    try {
      const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      if (res.status === 429) {
        this.consecutiveErrors = Math.max(this.consecutiveErrors, 3);
        throw new Error("OpenSky rate limit (429) — slowing down refresh.");
      }
      if (!res.ok) {
        throw new Error(`OpenSky HTTP ${res.status}`);
      }
      const json = await res.json();
      const states: any[][] = json.states ?? [];
      const flights = states.map(parseState).filter((s): s is FlightState => s !== null);
      // deck.gl's GPU position transition interpolates by array *index*, not
      // by identity — OpenSky doesn't guarantee stable ordering between
      // requests, so an unsorted array made unrelated aircraft appear to
      // swap positions (a plane "teleporting" across the continent) every
      // time the response order happened to shuffle. Sorting by icao24 keeps
      // each aircraft's index stable across polls so the transition tracks
      // the same real plane.
      flights.sort((a, b) => (a.icao24 < b.icao24 ? -1 : a.icao24 > b.icao24 ? 1 : 0));
      this.consecutiveErrors = 0;
      const updatedAt = (json.time ?? Date.now() / 1000) * 1000;
      for (const l of this.listeners) l(flights, { updatedAt, error: null });
    } catch (err) {
      this.consecutiveErrors++;
      const message = err instanceof Error ? err.message : "Unknown OpenSky error";
      for (const l of this.listeners) l(null, { updatedAt: Date.now(), error: message });
    } finally {
      this.inFlight = false;
      this.scheduleNext();
    }
  }
}
