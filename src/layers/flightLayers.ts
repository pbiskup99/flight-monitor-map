import { IconLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { FlightState } from "../data/opensky";
import { type FlightCluster, clusterIconSize } from "./screenCluster";
import { buildPlaneIconAtlas, CLUSTER_VARIANT } from "./planeIcon";

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
  // Pre-clustered by clusterFlights() (screen-space, recomputed per rebuild)
  // — a cluster of one renders as a normal heading-aware plane icon, 2+
  // render as a single direction-less glyph with a count badge.
  clusters: FlightCluster[];
  toggles: LayerToggles;
  selectedIcao24: string | null;
}

export function buildLayers(opts: BuildLayersOptions): Layer[] {
  const { clusters, toggles, selectedIcao24 } = opts;
  const layers: Layer[] = [];

  if (toggles.icons) {
    layers.push(
      new IconLayer<FlightCluster>({
        id: "flight-icons",
        data: clusters,
        iconAtlas: ICON_ATLAS.image,
        iconMapping: ICON_ATLAS.mapping,
        getIcon: (c) =>
          c.flights.length > 1 ? CLUSTER_VARIANT : variantFor(c.flights[0], c.flights[0].icao24 === selectedIcao24),
        getPosition: (c) => {
          const f = c.flights[0];
          const altitude = c.flights.length === 1 && (f.geoAltitude ?? 0) > 0 ? (f.geoAltitude as number) : 0;
          return [c.longitude, c.latitude, altitude];
        },
        // deck.gl's IconLayer rotates counter-compass (increasing getAngle
        // turns the glyph counterclockwise), so a clockwise compass bearing
        // needs negating to render correctly — confirmed against real
        // known-heading aircraft plus the same fix reported by other
        // deck.gl users converting compass headings for IconLayer. Clusters
        // have no single heading, so they don't rotate at all.
        getAngle: (c) => (c.flights.length > 1 ? 0 : -(c.flights[0].trueTrack ?? 0)),
        getSize: (c) =>
          c.flights.length > 1
            ? clusterIconSize(c.flights.length)
            : c.flights[0].icao24 === selectedIcao24
              ? 34
              : 20,
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

    const clusterLabels = clusters.filter((c) => c.flights.length > 1);
    if (clusterLabels.length > 0) {
      layers.push(
        new TextLayer<FlightCluster>({
          id: "flight-cluster-labels",
          data: clusterLabels,
          getPosition: (c) => [c.longitude, c.latitude, 0],
          getText: (c) => String(c.flights.length),
          getSize: 12,
          getColor: [255, 255, 255, 235],
          fontFamily: "system-ui, sans-serif",
          fontWeight: 700,
          fontSettings: { sdf: true },
          outlineWidth: 2,
          outlineColor: [40, 30, 60, 255],
          billboard: true,
          pickable: false
        })
      );
    }
  }

  return layers;
}
