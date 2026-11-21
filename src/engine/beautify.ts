import { decodeBackgroundImage, drawBackground, presetColors } from './background-render';
import type { Beautify } from './model';
import { type Ctx, roundRectPath } from './render';

/**
 * The background as a CSS gradient for a width × height frame. Matches
 * drawBeautified's corner-to-corner canvas gradient: at this angle the CSS
 * gradient line also runs from corner to corner.
 */
export function beautifyBackgroundCss(b: Beautify, width: number, height: number): string {
  if (typeof b.background !== 'number') return '';
  const [from, to] = presetColors(b.background);
  const angle = (Math.atan2(width, -height) * 180) / Math.PI;
  return `linear-gradient(${Number(angle.toFixed(3))}deg, ${from}, ${to})`;
}

export function beautifiedSize(width: number, height: number, b: Beautify, unit: number) {
  const pad = Math.round(b.padding * unit);
  return { width: width + pad * 2, height: height + pad * 2, pad };
}

export async function frameImage(
  image: OffscreenCanvas,
  b: Beautify,
  unit: number,
): Promise<OffscreenCanvas> {
  if (!b.enabled) return image;
  const size = beautifiedSize(image.width, image.height, b, unit);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  const background =
    typeof b.background !== 'number' && b.background.kind === 'image'
      ? await decodeBackgroundImage(b.background.data)
      : null;
  try {
    drawBeautified(ctx, image, image.width, image.height, b, unit, background);
  } finally {
    background?.close();
  }
  return canvas;
}

/** Draws `image` framed on a background with rounded corners and a shadow. */
export function drawBeautified(
  ctx: Ctx,
  image: CanvasImageSource,
  width: number,
  height: number,
  b: Beautify,
  unit: number,
  background?: ImageBitmap | null,
): void {
  const out = beautifiedSize(width, height, b, unit);
  drawBackground(ctx, b.background, out.width, out.height, background);
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
