import type { Background, GradientBackground, ImageBackground } from '../shared/background';
import type { Ctx } from './render';

/** Built-in backgrounds retain their corner-to-corner geometry. */
export const BACKGROUNDS: readonly [string, string][] = [
  ['#5eead4', '#6366f1'],
  ['#fda4af', '#f59e0b'],
  ['#a5b4fc', '#ec4899'],
  ['#86efac', '#0ea5e9'],
  ['#fde68a', '#f97316'],
  ['#e2e8f0', '#94a3b8'],
  ['#1e293b', '#0f172a'],
  ['#c4b5fd', '#22d3ee'],
];

export function presetColors(index: number): [string, string] {
  return BACKGROUNDS[index % BACKGROUNDS.length] ?? ['#ffffff', '#ffffff'];
}

export function sortedStops(stops: GradientBackground['stops']): GradientBackground['stops'] {
  return [...stops].sort((a, b) => a.position - b.position);
}

function gradientFor(
  ctx: Ctx,
  b: GradientBackground,
  width: number,
  height: number,
): CanvasGradient {
  const angle = (b.angle * Math.PI) / 180;
  const x = (b.x / 100) * width;
  const y = (b.y / 100) * height;
  if (b.type === 'conic') return ctx.createConicGradient(angle - Math.PI / 2, x, y);
  if (b.type === 'radial') {
    const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
    return ctx.createRadialGradient(x, y, 0, x, y, radius);
  }
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const half = (Math.abs(dx) * width + Math.abs(dy) * height) / 2;
  return ctx.createLinearGradient(
    width / 2 - dx * half,
    height / 2 - dy * half,
    width / 2 + dx * half,
    height / 2 + dy * half,
  );
}

const meshCache = new WeakMap<GradientBackground, OffscreenCanvas>();
const linearChannels = Array.from({ length: 256 }, (_, n) => {
  const c = n / 255;
  return c < 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const toSrgb = (c: number) => 255 * (c < 0.00313 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** A small interpolated field stays fast as points move and scales without hard edges. */
function mesh(b: GradientBackground): OffscreenCanvas {
  const cached = meshCache.get(b);
  if (cached) return cached;
  const size = 96;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const image = ctx.createImageData(size, size);
  const points = b.points.map(({ x, y, color }) => {
    const channel = (start: number) =>
      linearChannels[Number.parseInt(color.slice(start, start + 2), 16)] ?? 0;
    return { x: x / 100, y: y / 100, r: channel(1), g: channel(3), b: channel(5) };
  });
  const power = 2.4 - b.softness * 0.018;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let r = 0;
      let g = 0;
      let blue = 0;
      for (const point of points) {
        const dx = x / (size - 1) - point.x;
        const dy = y / (size - 1) - point.y;
        const weight = (dx * dx + dy * dy + 0.0004) ** -power;
        sum += weight;
        r += point.r * weight;
        g += point.g * weight;
        blue += point.b * weight;
      }
      const i = (y * size + x) * 4;
      image.data[i] = toSrgb(r / sum);
      image.data[i + 1] = toSrgb(g / sum);
      image.data[i + 2] = toSrgb(blue / sum);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  meshCache.set(b, canvas);
  return canvas;
}

function patternTile({ type, color }: GradientBackground['pattern']): OffscreenCanvas {
  const tile = new OffscreenCanvas(96, 96);
  const ctx = tile.getContext('2d');
  if (!ctx) return tile;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  switch (type) {
    case 'dots':
      ctx.arc(48, 48, 7, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'grid':
      ctx.fillRect(0, 0, 96, 2.5);
      ctx.fillRect(0, 0, 2.5, 96);
      break;
    case 'stripes':
      ctx.fillRect(0, 0, 12, 96);
      break;
    case 'waves':
      ctx.moveTo(-2, 48);
      ctx.lineTo(0, 48);
      ctx.bezierCurveTo(24, 14, 72, 82, 96, 48);
      ctx.lineTo(98, 48);
      ctx.stroke();
      break;
    case 'diamonds':
      ctx.moveTo(48, 4);
      ctx.lineTo(92, 48);
      ctx.lineTo(48, 92);
      ctx.lineTo(4, 48);
      ctx.closePath();
      ctx.stroke();
      break;
  }
  return tile;
}

let grain: OffscreenCanvas | undefined;
function grainTile(): OffscreenCanvas {
  if (grain) return grain;
  const tile = new OffscreenCanvas(128, 128);
  const ctx = tile.getContext('2d');
  if (!ctx) return tile;
  const image = ctx.createImageData(128, 128);
  let seed = 31733;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const tone = seed >>> 24;
    image.data.set([tone, tone, tone, 255], i);
  }
  ctx.putImageData(image, 0, 0);
  grain = tile;
  return tile;
}

function layer(
  ctx: Ctx,
  tile: OffscreenCanvas,
  width: number,
  height: number,
  size: number,
  angle: number,
  opacity: number,
  blend: GlobalCompositeOperation,
): void {
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  pattern.setTransform(
    new DOMMatrix()
      .translate(width / 2, height / 2)
      .rotate(angle)
      .scale(size / tile.width),
  );
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = blend;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

export function drawBackground(
  ctx: Ctx,
  b: Background,
  width: number,
  height: number,
  image?: ImageBitmap | HTMLImageElement | null,
): void {
  if (typeof b === 'number') {
    const [from, to] = presetColors(b);
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    return;
  }
  if (b.kind === 'image') {
    ctx.fillStyle = b.matte;
    ctx.fillRect(0, 0, width, height);
    if (image) {
      const scale = (b.fit === 'cover' ? Math.max : Math.min)(
        width / image.width,
        height / image.height,
      );
      const w = image.width * scale;
      const h = image.height * scale;
      ctx.drawImage(image, ((width - w) * b.x) / 100, ((height - h) * b.y) / 100, w, h);
    }
    return;
  }
  if (b.type === 'mesh') {
    ctx.drawImage(mesh(b), 0, 0, width, height);
  } else {
    const gradient = gradientFor(ctx, b, width, height);
    for (const stop of sortedStops(b.stops)) gradient.addColorStop(stop.position / 100, stop.color);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  const short = Math.min(width, height);
  const p = b.pattern;
  if (p.type !== 'none' && p.opacity > 0) {
    layer(
      ctx,
      patternTile(p),
      width,
      height,
      short * (0.02 + p.scale / 500),
      p.angle,
      p.opacity / 100,
      p.blend === 'normal' ? 'source-over' : p.blend,
    );
  }
  if (b.grain > 0)
    layer(ctx, grainTile(), width, height, short / 3, 0, b.grain / 100, 'soft-light');
}

export async function decodeBackgroundImage(
  data: ImageBackground['data'],
): Promise<ImageBitmap | null> {
  try {
    const payload = data.slice(data.indexOf(',') + 1);
    const bytes = Uint8Array.from(atob(payload), (character) => character.charCodeAt(0));
    return await createImageBitmap(new Blob([bytes], { type: 'image/webp' }));
  } catch {
    return null;
  }
}
