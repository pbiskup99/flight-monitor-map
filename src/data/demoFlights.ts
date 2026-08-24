import type { FlightState } from "./opensky";
import type { BBox } from "./opensky";

/**
 * OpenSky's anonymous endpoint is unreliable (frequent 503s under any load).
 * When live polling keeps failing, the dashboard falls back to a small set
 * of synthetic flights so the map, IconLayer, click/select, and 3D plane
 * panel all still have something to show — clearly labeled as demo data in
 * the UI, and dropped the instant a real OpenSky response arrives.
 */

const CALLSIGNS = [
  "LOT123", "BAW45X", "DLH88", "AFR221", "KLM70", "RYR9K", "EZY31", "SWR14",
  "IBE55", "SAS201", "TAP77", "FIN9", "AUA6", "AZA10", "TUI44"
];
const COUNTRIES = ["Poland", "United Kingdom", "Germany", "France", "Netherlands", "Ireland", "Switzerland", "Spain"];

const WORLD_BBOX: BBox = { lamin: -55, lomin: -170, lamax: 70, lomax: 170 };

interface DemoFlight extends FlightState {
  headingRad: number;
  speedMps: number;
}

let demoState: DemoFlight[] = [];

export function generateDemoFlights(bbox: BBox | null, count = 18): FlightState[] {
  const box = bbox ?? WORLD_BBOX;
  demoState = Array.from({ length: count }, (_, i) => {
    const lon = box.lomin + Math.random() * (box.lomax - box.lomin);
    const lat = box.lamin + Math.random() * (box.lamax - box.lamin);
    const heading = Math.random() * 360;
    const speedMps = 180 + Math.random() * 70;
    return {
      icao24: `demo${i.toString(16).padStart(2, "0")}`,
      callsign: CALLSIGNS[i % CALLSIGNS.length],
      originCountry: COUNTRIES[i % COUNTRIES.length],
      longitude: lon,
      latitude: lat,
      baroAltitude: 9000 + Math.random() * 3000,
      onGround: false,
      velocity: speedMps,
      trueTrack: heading,
      verticalRate: Math.random() > 0.8 ? (Math.random() > 0.5 ? 4 : -4) : 0,
      geoAltitude: 9500 + Math.random() * 3000,
      lastContact: Date.now() / 1000,
      headingRad: (heading * Math.PI) / 180,
      speedMps
    };
  });
  return demoState;
}

/** Dead-reckons the demo fleet forward by `dtSeconds`, wrapping at the bbox edges. */
export function advanceDemoFlights(bbox: BBox | null, dtSeconds: number): FlightState[] {
  const box = bbox ?? WORLD_BBOX;
  for (const f of demoState) {
    const latRad = (f.latitude * Math.PI) / 180;
    const dLon = ((f.speedMps * Math.sin(f.headingRad)) / (111_320 * Math.max(0.2, Math.cos(latRad)))) * dtSeconds;
    const dLat = ((f.speedMps * Math.cos(f.headingRad)) / 111_320) * dtSeconds;
    f.longitude += dLon;
    f.latitude += dLat;
    f.lastContact = Date.now() / 1000;
    if (f.longitude > box.lomax || f.longitude < box.lomin || f.latitude > box.lamax || f.latitude < box.lamin) {
      f.longitude = box.lomin + Math.random() * (box.lomax - box.lomin);
      f.latitude = box.lamin + Math.random() * (box.lamax - box.lamin);
      f.headingRad = Math.random() * Math.PI * 2;
      f.trueTrack = (f.headingRad * 180) / Math.PI;
    }
  }
  return demoState;
}
