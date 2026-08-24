/** Builds a small icon atlas (single plane silhouette, a few tint variants)
 * on an offscreen canvas at runtime, so deck.gl's IconLayer has a texture to
 * sample without shipping binary image assets. The glyph points "up"
 * (north) at rotation 0, matching IconLayer's default rotation convention. */

const GLYPH_SIZE = 64;

function drawPlane(ctx: CanvasRenderingContext2D, ox: number, color: string) {
  const s = GLYPH_SIZE;
  ctx.save();
  ctx.translate(ox + s / 2, s / 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  // Simple top-down aircraft silhouette: nose up (+y is down in canvas, so
  // "up" = negative y), fuselage + swept wings + tail.
  ctx.moveTo(0, -s * 0.42);
  ctx.lineTo(s * 0.07, -s * 0.2);
  ctx.lineTo(s * 0.42, s * 0.08);
  ctx.lineTo(s * 0.42, s * 0.18);
  ctx.lineTo(s * 0.09, s * 0.06);
  ctx.lineTo(s * 0.11, s * 0.34);
  ctx.lineTo(s * 0.24, s * 0.44);
  ctx.lineTo(s * 0.24, s * 0.5);
  ctx.lineTo(0, s * 0.44);
  ctx.lineTo(-s * 0.24, s * 0.5);
  ctx.lineTo(-s * 0.24, s * 0.44);
  ctx.lineTo(-s * 0.11, s * 0.34);
  ctx.lineTo(-s * 0.09, s * 0.06);
  ctx.lineTo(-s * 0.42, s * 0.18);
  ctx.lineTo(-s * 0.42, s * 0.08);
  ctx.lineTo(-s * 0.07, -s * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Clusters have no single heading to point in, so they get a plain filled
// dot with a ring around it (rather than a plane silhouette that would imply
// a direction) — visually distinct at a glance from any real aircraft.
function drawCluster(ctx: CanvasRenderingContext2D, ox: number, color: string) {
  const s = GLYPH_SIZE;
  ctx.save();
  ctx.translate(ox + s / 2, s / 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = s * 0.06;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export interface PlaneIconAtlas {
  image: HTMLCanvasElement;
  mapping: Record<string, { x: number; y: number; width: number; height: number; anchorY: number; mask: boolean }>;
}

/** variant key -> css color used to tint that glyph in the atlas. */
export const ICON_VARIANTS: Record<string, string> = {
  cruise: "#3987e5",
  climb: "#199e70",
  descend: "#d95926",
  ground: "#898781",
  selected: "#3a3a3a"
};

export const CLUSTER_VARIANT = "cluster";
const CLUSTER_COLOR = "#7c5cbf";

export function buildPlaneIconAtlas(): PlaneIconAtlas {
  const keys = Object.keys(ICON_VARIANTS);
  const canvas = document.createElement("canvas");
  canvas.width = GLYPH_SIZE * (keys.length + 1);
  canvas.height = GLYPH_SIZE;
  const ctx = canvas.getContext("2d")!;

  const mapping: PlaneIconAtlas["mapping"] = {};
  keys.forEach((key, i) => {
    drawPlane(ctx, i * GLYPH_SIZE, ICON_VARIANTS[key]);
    mapping[key] = {
      x: i * GLYPH_SIZE,
      y: 0,
      width: GLYPH_SIZE,
      height: GLYPH_SIZE,
      anchorY: GLYPH_SIZE / 2,
      mask: false
    };
  });

  drawCluster(ctx, keys.length * GLYPH_SIZE, CLUSTER_COLOR);
  mapping[CLUSTER_VARIANT] = {
    x: keys.length * GLYPH_SIZE,
    y: 0,
    width: GLYPH_SIZE,
    height: GLYPH_SIZE,
    anchorY: GLYPH_SIZE / 2,
    mask: false
  };

  return { image: canvas, mapping };
}
