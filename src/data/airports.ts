/**
 * ICAO airport code -> "City, Country" label lookup, used to make the
 * selected-flight route readable (OpenSky's /flights/aircraft endpoint only
 * gives raw ICAO codes like "EPWA"). Backed by a pruned {icao: [city,
 * countryCode]} JSON built from mwgg/Airports (MIT) — see
 * public/data/airports-min.json. Fetched lazily and cached in memory since
 * it's ~750KB and most sessions only select a handful of flights.
 */

const AIRPORTS_URL = "/data/airports-min.json";

type AirportTable = Record<string, [city: string, countryCode: string]>;

let tablePromise: Promise<AirportTable> | null = null;

function loadTable(): Promise<AirportTable> {
  if (!tablePromise) {
    tablePromise = fetch(AIRPORTS_URL).then((res) => {
      if (!res.ok) throw new Error(`Failed to load airport database: HTTP ${res.status}`);
      return res.json() as Promise<AirportTable>;
    });
  }
  return tablePromise;
}

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

/** Resolves an ICAO airport code to "City, Country". Falls back to the raw
 * code if it's not in the database (small strips, military fields, etc.). */
export async function resolveAirportLabel(icaoCode: string): Promise<string> {
  try {
    const table = await loadTable();
    const entry = table[icaoCode];
    if (!entry) return icaoCode;
    const [city, countryCode] = entry;
    let country = countryCode;
    try {
      country = countryNames.of(countryCode) ?? countryCode;
    } catch {
      // Not a valid ISO region code — show it as-is rather than failing.
    }
    return country ? `${city}, ${country}` : city;
  } catch {
    return icaoCode;
  }
}
