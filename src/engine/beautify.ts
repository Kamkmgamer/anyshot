import type { Beautify } from './model';
import { type Ctx, roundRectPath } from './render';

/** Built-in backgrounds for Beautify: two-stop diagonal gradients. */
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

export function beautifiedSize(width: number, height: number, b: Beautify, unit: number) {
  const pad = Math.round(b.padding * unit);
  return { width: width + pad * 2, height: height + pad * 2, pad };
}

/** Draws `image` framed on a gradient background with rounded corners and a shadow. */
export function drawBeautified(
  ctx: Ctx,
  image: CanvasImageSource,
  width: number,
  height: number,
  b: Beautify,
  unit: number,
): void {
  const out = beautifiedSize(width, height, b, unit);
  const [from, to] = BACKGROUNDS[b.background % BACKGROUNDS.length] ?? ['#ffffff', '#ffffff'];
  const gradient = ctx.createLinearGradient(0, 0, out.width, out.height);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, out.width, out.height);
  const frame = { x: out.pad, y: out.pad, width, height };
  const radius = b.radius * unit;
  if (b.shadow > 0) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = b.shadow * unit;
    ctx.shadowOffsetY = b.shadow * unit * 0.25;
    ctx.fillStyle = '#000';
    roundRectPath(ctx, frame, radius);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  roundRectPath(ctx, frame, radius);
  ctx.clip();
  ctx.drawImage(image, out.pad, out.pad);
  ctx.restore();
}
