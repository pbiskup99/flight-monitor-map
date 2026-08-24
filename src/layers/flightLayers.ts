import { IconLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { FlightState } from "../data/opensky";
import { buildPlaneIconAtlas } from "./planeIcon";

const ICON_ATLAS = buildPlaneIconAtlas();

function variantFor(f: FlightState, isSelected: boolean): string {
  if (isSelected) return "selected";
  if (f.onGround) return "ground";
  const vr = f.verticalRate ?? 0;
  if (vr > 1) return "climb";
  if (vr < -1) return "descend";
  return "cruise";
}

export interface LayerToggles {
  icons: boolean;
}

export interface BuildLayersOptions {
  // Positions are expected to already be smoothly interpolated per-frame
  // (see FlightInterpolator) — this layer renders them as-is rather than
  // running its own GPU position transition, since that interpolates by
  // array index and gets confused by OpenSky's unstable ordering.
  flights: FlightState[];
  toggles: LayerToggles;
  selectedIcao24: string | null;
}

export function buildLayers(opts: BuildLayersOptions): Layer[] {
  const { flights, toggles, selectedIcao24 } = opts;
  const layers: Layer[] = [];

  if (toggles.icons) {
    layers.push(
      new IconLayer<FlightState>({
        id: "flight-icons",
        data: flights,
        iconAtlas: ICON_ATLAS.image,
        iconMapping: ICON_ATLAS.mapping,
        getIcon: (f) => variantFor(f, f.icao24 === selectedIcao24),
        getPosition: (f) => [f.longitude, f.latitude, (f.geoAltitude ?? 0) > 0 ? (f.geoAltitude as number) : 0],
        // deck.gl's IconLayer rotates counter-compass (increasing getAngle
        // turns the glyph counterclockwise), so a clockwise compass bearing
        // needs negating to render correctly — confirmed against real
        // known-heading aircraft plus the same fix reported by other
        // deck.gl users converting compass headings for IconLayer.
        getAngle: (f) => -(f.trueTrack ?? 0),
        getSize: (f) => (f.icao24 === selectedIcao24 ? 34 : 20),
        sizeUnits: "pixels",
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 80],
        // Click/hover are handled at the MapboxOverlay level (main.ts)
        // rather than per-layer — see the comment there for why.
        updateTriggers: {
          getIcon: [selectedIcao24],
          getSize: [selectedIcao24]
        }
      })
    );
  }

  return layers;
}
