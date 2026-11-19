import { beautifiedSize, drawBeautified } from './beautify';
import { parseDoc } from './document';
import { adjustFilter, GlEffects } from './gl';
import { isAdjustNeutral } from './model';
import { censorFallback, drawDoc, type RenderEnv } from './render';

let gl: GlEffects | null | undefined;
function effects(): GlEffects | null {
  if (gl === undefined) gl = GlEffects.create();
  return gl;
}

function context(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  return ctx;
}

/**
 * Produces the final image: base pixels (with colour adjustments), then the
 * annotations replayed on top, then the optional Beautify frame.
 */
export async function composeInto(bitmap: ImageBitmap, rawDoc: unknown): Promise<OffscreenCanvas> {
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = context(canvas);
  if (!rawDoc) {
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  }
  const doc = parseDoc(rawDoc);
  const fx = effects();
  const { adjust, invert, beautify } = doc.effects;
  const adjusted = invert || !isAdjustNeutral(adjust);
  if (adjusted && fx) {
    ctx.drawImage(fx.adjust(bitmap, width, height, adjust, invert), 0, 0);
  } else {
    if (adjusted) ctx.filter = adjustFilter(adjust, invert);
    ctx.drawImage(bitmap, 0, 0);
    ctx.filter = 'none';
  }
  // Censor reads the adjusted pixels so redaction matches what the user saw.
  const base = new OffscreenCanvas(width, height);
  context(base).drawImage(canvas, 0, 0);
  const env: RenderEnv = {
    source: base,
    width,
    height,
    unit: doc.unit,
    censor: fx ? (c, s, a) => fx.censor(c, s, a) : censorFallback,
  };
  drawDoc(ctx, doc, env);
  if (!beautify.enabled) return canvas;
  const size = beautifiedSize(width, height, beautify, doc.unit);
  const framed = new OffscreenCanvas(size.width, size.height);
  drawBeautified(context(framed), canvas, width, height, beautify, doc.unit);
  return framed;
}
