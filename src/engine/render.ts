import { clampRect, distance, type Point, type Rect, rectFromPoints } from '../shared/geometry';
import type {
  Annotation,
  BoxAnnotation,
  CensorAnnotation,
  Doc,
  MagnifyAnnotation,
  NumberAnnotation,
  SegmentAnnotation,
  SpotlightAnnotation,
  StampAnnotation,
  Stroke,
  TextAnnotation,
} from './model';
import { markerWidth, TEXT_LINE_HEIGHT, textBox, textFont, UNDERLINE } from './shapes';

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Samples a whole-pixel rectangle into a separate patch. */
export type CensorRenderer = (
  source: CanvasImageSource,
  rect: Rect,
  mode: Exclude<CensorAnnotation['mode'], 'solid'>,
) => OffscreenCanvas | null;

export interface RenderEnv {
  /** Base image in annotation coordinates; censor, magnify and spotlight read from it. */
  source: CanvasImageSource | null;
  width: number;
  height: number;
  /** Image pixels per CSS pixel, for UI-like sizes such as measure labels. */
  unit: number;
  censor?: CensorRenderer;
}

/**
 * Renders every annotation. Image effects (censor, spotlight) go below drawn marks.
 * Returns the environment the marks were drawn with: its source already has the
 * censors applied, so a magnifier can never reveal what a censor covers.
 */
export function drawAnnotations(
  ctx: Ctx,
  annotations: readonly Annotation[],
  env: RenderEnv,
  skip?: ReadonlySet<string>,
): RenderEnv {
  const visible = skip ? annotations.filter((a) => !skip.has(a.id)) : annotations;
  const censors = visible.filter((a): a is CensorAnnotation => a.kind === 'censor');
  const marksEnv = censors.length > 0 ? drawCensors(ctx, censors, env) : env;
  const spots = visible.filter((a): a is SpotlightAnnotation => a.kind === 'spotlight');
  if (spots.length > 0) drawSpotlights(ctx, spots, env);
  for (const a of visible)
    if (a.kind !== 'censor' && a.kind !== 'spotlight') drawAnnotation(ctx, a, marksEnv);
  return marksEnv;
}

/**
 * Applies the censors in order to a copy of the source, so each one (and every
 * later image-reading annotation) sees the image as already censored, then
 * copies the censored areas onto ctx.
 */
function drawCensors(ctx: Ctx, censors: readonly CensorAnnotation[], env: RenderEnv): RenderEnv {
  const masks = censors.flatMap((a) => {
    const rect = censorBounds(a.rect, env);
    return rect ? [{ ...a, rect }] : [];
  });
  if (!env.source || masks.length === 0) {
    for (const a of masks) paintCensor(ctx, a, env);
    return env;
  }
  const censored = new OffscreenCanvas(env.width, env.height);
  const cctx = censored.getContext('2d');
  if (!cctx) throw new Error('2D context unavailable');
  cctx.drawImage(env.source, 0, 0);
  const censoredEnv: RenderEnv = { ...env, source: censored };
  for (const a of masks) paintCensor(cctx, a, censoredEnv);
  for (const {
    rect: { x, y, width, height },
  } of masks) {
    ctx.drawImage(censored, x, y, width, height, x, y, width, height);
  }
  return censoredEnv;
}

export function drawDoc(ctx: Ctx, doc: Doc, env: RenderEnv, skip?: ReadonlySet<string>): void {
  drawAnnotations(ctx, doc.annotations, env, skip);
}

/** Draws a single annotation (used for drafts and drags on the interaction layer). */
export function drawAnnotation(ctx: Ctx, a: Annotation, env: RenderEnv): void {
  ctx.save();
  switch (a.kind) {
    case 'pencil':
      drawPath(ctx, a.points, a.stroke, a.stroke.width, 1);
      break;
    case 'marker':
      drawPath(ctx, a.points, { ...a.stroke, style: 'solid' }, markerWidth(a.stroke.width), 0.38);
      break;
    case 'line':
      applyStroke(ctx, a.stroke);
      line(ctx, a.a, a.b);
      break;
    case 'arrow':
      drawArrow(ctx, a);
      break;
    case 'measure':
      drawMeasure(ctx, a, env.unit);
      break;
    case 'rect':
    case 'ellipse':
      drawBox(ctx, a);
      break;
    case 'text':
      drawText(ctx, a);
      break;
    case 'number':
      drawNumber(ctx, a);
      break;
    case 'magnify':
      drawMagnify(ctx, a, env);
      break;
    case 'stamp':
      drawStamp(ctx, a);
      break;
    case 'censor':
      {
        const rect = censorBounds(a.rect, env);
        if (rect) paintCensor(ctx, { ...a, rect }, env);
      }
      break;
    case 'spotlight':
      drawSpotlights(ctx, [a], env);
      break;
  }
  ctx.restore();
}

function dash(s: Stroke): number[] {
  if (s.style === 'dashed') return [s.width * 2.5, s.width * 2];
  if (s.style === 'dotted') return [0.01, s.width * 2];
  return [];
}

function applyStroke(ctx: Ctx, s: Stroke): void {
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash(s));
}

function line(ctx: Ctx, a: Point, b: Point): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** Smooth freehand path: quadratic curves through midpoints of the samples. */
function drawPath(ctx: Ctx, points: readonly Point[], s: Stroke, width: number, alpha: number) {
  const first = points[0];
  if (!first) return;
  applyStroke(ctx, s);
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  if (alpha < 1) ctx.lineCap = 'square';
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  if (points.length === 1) {
    ctx.lineTo(first.x + 0.01, first.y);
  } else {
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i] as Point;
      const n = points[i + 1] as Point;
      ctx.quadraticCurveTo(p.x, p.y, (p.x + n.x) / 2, (p.y + n.y) / 2);
    }
    const last = points[points.length - 1] as Point;
    ctx.lineTo(last.x, last.y);
  }
  ctx.stroke();
}

function drawArrow(ctx: Ctx, a: SegmentAnnotation): void {
  const len = distance(a.a, a.b);
  if (len < 1) return;
  const w = a.stroke.width;
  const head = Math.min(len * 0.6, Math.max(14, w * 3.4));
  const ux = (a.b.x - a.a.x) / len;
  const uy = (a.b.y - a.a.y) / len;
  const base = { x: a.b.x - ux * head * 0.8, y: a.b.y - uy * head * 0.8 };
  applyStroke(ctx, a.stroke);
  line(ctx, a.a, base);
  ctx.setLineDash([]);
  ctx.fillStyle = a.stroke.color;
  const half = head * 0.52;
  const back = { x: a.b.x - ux * head, y: a.b.y - uy * head };
  ctx.beginPath();
  ctx.moveTo(a.b.x, a.b.y);
  ctx.lineTo(back.x - uy * half, back.y + ux * half);
  ctx.lineTo(base.x, base.y);
  ctx.lineTo(back.x + uy * half, back.y - ux * half);
  ctx.closePath();
  ctx.lineWidth = Math.max(1, w * 0.5);
  ctx.stroke();
  ctx.fill();
}

export function measureLabel(a: SegmentAnnotation): string {
  return `${Math.round(distance(a.a, a.b))} px`;
}

function drawMeasure(ctx: Ctx, a: SegmentAnnotation, unit: number): void {
  applyStroke(ctx, { ...a.stroke, style: 'solid' });
  line(ctx, a.a, a.b);
  const len = distance(a.a, a.b);
  if (len < 1) return;
  const nx = -(a.b.y - a.a.y) / len;
  const ny = (a.b.x - a.a.x) / len;
  const tick = Math.max(6, a.stroke.width * 2.5);
  for (const p of [a.a, a.b])
    line(
      ctx,
      { x: p.x - nx * tick, y: p.y - ny * tick },
      { x: p.x + nx * tick, y: p.y + ny * tick },
    );
  const label = measureLabel(a);
  const size = 12 * unit;
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  const tw = ctx.measureText(label).width;
  const mid = { x: (a.a.x + a.b.x) / 2, y: (a.a.y + a.b.y) / 2 };
  const pad = 5 * unit;
  ctx.fillStyle = 'rgba(17,17,17,0.85)';
  roundRectPath(
    ctx,
    {
      x: mid.x - tw / 2 - pad,
      y: mid.y - size / 2 - pad,
      width: tw + pad * 2,
      height: size + pad * 2,
    },
    6 * unit,
  );
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, mid.x, mid.y + 0.5);
}

export function roundRectPath(ctx: Ctx, r: Rect, radius: number): void {
  const rr = Math.max(0, Math.min(radius, r.width / 2, r.height / 2));
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.width, r.height, rr);
}

function translucent(color: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${color.slice(0, 7)}${a}`;
}

function drawBox(ctx: Ctx, a: BoxAnnotation): void {
  const { x, y, width, height } = a.rect;
  if (width < 1 && height < 1) return;
  ctx.beginPath();
  if (a.kind === 'rect')
    ctx.roundRect(x, y, width, height, Math.min(a.radius, width / 2, height / 2));
  else ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  if (a.fill !== 'stroke') {
    ctx.fillStyle = a.fill === 'fill' ? a.stroke.color : translucent(a.stroke.color, 0.28);
    ctx.fill();
  }
  if (a.fill !== 'fill') {
    applyStroke(ctx, a.stroke);
    ctx.stroke();
  }
}

/** Black or white, whichever reads better on the given colour. */
export function contrastColor(hex: string): string {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111111' : '#ffffff';
}

function drawText(ctx: Ctx, a: TextAnnotation): void {
  const lines = a.text.split('\n');
  ctx.font = textFont(a.size, a.style);
  ctx.textBaseline = 'top';
  const outline = !a.background && a.style.outline;
  if (a.background) {
    ctx.fillStyle = a.color;
    roundRectPath(ctx, textBox(a), a.size * 0.25);
    ctx.fill();
    ctx.fillStyle = contrastColor(a.color);
  } else {
    ctx.fillStyle = a.color;
  }
  if (outline) {
    // A soft outline keeps text readable on busy backgrounds.
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, a.size * 0.12);
    ctx.strokeStyle =
      contrastColor(a.color) === '#ffffff' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.6)';
  }
  const thickness = Math.max(1, a.size * UNDERLINE.thickness);
  lines.forEach((text, i) => {
    const y = a.at.y + i * a.size * TEXT_LINE_HEIGHT + a.size * 0.08;
    const underline =
      a.style.underline && text.trim()
        ? { y: y + a.size * UNDERLINE.offset, width: ctx.measureText(text).width }
        : null;
    if (outline) {
      ctx.strokeText(text, a.at.x, y);
      if (underline) ctx.strokeRect(a.at.x, underline.y, underline.width, thickness);
    }
    ctx.fillText(text, a.at.x, y);
    if (underline) ctx.fillRect(a.at.x, underline.y, underline.width, thickness);
  });
}

function drawNumber(ctx: Ctx, a: NumberAnnotation): void {
  const r = a.size / 2;
  ctx.beginPath();
  ctx.arc(a.at.x, a.at.y, r, 0, Math.PI * 2);
  ctx.fillStyle = a.color;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, a.size * 0.06);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
  ctx.fillStyle = contrastColor(a.color);
  ctx.font = `700 ${a.size * 0.55}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(a.value), a.at.x, a.at.y + a.size * 0.03);
}

function drawStamp(ctx: Ctx, a: StampAnnotation): void {
  ctx.font = `${a.size}px "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(a.emoji, a.at.x, a.at.y);
}

function drawMagnify(ctx: Ctx, a: MagnifyAnnotation, env: RenderEnv): void {
  if (env.source) {
    const src = a.radius / a.zoom;
    ctx.save();
    ctx.beginPath();
    ctx.arc(a.at.x, a.at.y, a.radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = a.zoom < 3;
    ctx.drawImage(
      env.source,
      a.at.x - src,
      a.at.y - src,
      src * 2,
      src * 2,
      a.at.x - a.radius,
      a.at.y - a.radius,
      a.radius * 2,
      a.radius * 2,
    );
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(a.at.x, a.at.y, a.radius, 0, Math.PI * 2);
  ctx.lineWidth = 3 * env.unit;
  ctx.strokeStyle = a.color;
  ctx.stroke();
}

/** Canvas 2D fallback for censoring when WebGL isn't available. */
export const censorFallback: CensorRenderer = (source, rect, mode) => {
  const { x, y, width, height } = rect;
  const patch = new OffscreenCanvas(width, height);
  const ctx = patch.getContext('2d');
  if (!ctx) return null;
  if (mode === 'blur') {
    const radius = Math.max(6, Math.min(width, height) * 0.08);
    const pad = radius * 3;
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(
      source,
      x - pad,
      y - pad,
      width + pad * 2,
      height + pad * 2,
      -pad,
      -pad,
      width + pad * 2,
      height + pad * 2,
    );
  } else {
    const block = Math.max(6, Math.round(Math.min(width, height) / 12));
    const w = Math.ceil(width / block);
    const h = Math.ceil(height / block);
    const small = new OffscreenCanvas(w, h);
    const sctx = small.getContext('2d');
    if (!sctx) return null;
    sctx.drawImage(source, x, y, width, height, 0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, w, h, 0, 0, w * block, h * block);
  }
  return patch;
};

function censorBounds(input: Rect, bounds: { width: number; height: number }): Rect | null {
  const { x, y, width, height } = input;
  const end = { x: x + width, y: y + height };
  if (![x, y, end.x, end.y].every(Number.isFinite)) return null;
  const rect = clampRect(rectFromPoints({ x, y }, end), bounds);
  if (rect.width <= 0 || rect.height <= 0) return null;
  const left = Math.floor(rect.x);
  const top = Math.floor(rect.y);
  return {
    x: left,
    y: top,
    width: Math.ceil(rect.x + rect.width) - left,
    height: Math.ceil(rect.y + rect.height) - top,
  };
}

function paintCensor(ctx: Ctx, a: CensorAnnotation, env: RenderEnv): void {
  const { x, y, width, height } = a.rect;
  const patch =
    env.source && a.mode !== 'solid'
      ? (env.censor ?? censorFallback)(env.source, a.rect, a.mode)
      : null;
  // Sample first, then paint an opaque backing. The filtered alpha must never
  // reveal the original on this canvas or on a separate layer beneath it.
  ctx.fillStyle = '#111111';
  ctx.fillRect(x, y, width, height);
  if (patch?.width === width && patch.height === height) ctx.drawImage(patch, x, y);
}

function drawSpotlights(ctx: Ctx, spots: readonly SpotlightAnnotation[], env: RenderEnv): void {
  const only = spots.length === 1 ? spots[0] : undefined;
  if (only) {
    // One hole: an even-odd path is enough and avoids a full-size scratch canvas per frame.
    const r = only.rect;
    ctx.beginPath();
    ctx.rect(0, 0, env.width, env.height);
    ctx.roundRect(r.x, r.y, r.width, r.height, Math.min(16 * env.unit, r.width / 4, r.height / 4));
    ctx.fillStyle = `rgba(0,0,0,${only.dim})`;
    ctx.fill('evenodd');
    return;
  }
  // Overlapping holes need real compositing: dim a layer, cut every hole out of it.
  const layer = new OffscreenCanvas(Math.max(1, env.width), Math.max(1, env.height));
  const lctx = layer.getContext('2d');
  if (!lctx) return;
  const dim = Math.max(...spots.map((s) => s.dim));
  lctx.fillStyle = `rgba(0,0,0,${dim})`;
  lctx.fillRect(0, 0, layer.width, layer.height);
  lctx.globalCompositeOperation = 'destination-out';
  lctx.fillStyle = '#000';
  for (const s of spots) {
    roundRectPath(lctx, s.rect, Math.min(16 * env.unit, s.rect.width / 4, s.rect.height / 4));
    lctx.fill();
  }
  ctx.drawImage(layer, 0, 0);
}
