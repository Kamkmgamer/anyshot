/// <reference lib="webworker" />
import { composeInto } from '../engine/compose';
import { canvasTextMeasurer, setTextMeasurer } from '../engine/shapes';
import type { ExportDone, ExportFailed, ExportJob } from './export-protocol';

// Export by replay: draw the base image and the annotations onto an
// OffscreenCanvas at full resolution, then encode with Chromium's encoders.
// All of this runs off the window's main thread.
const scope = self as unknown as DedicatedWorkerGlobalScope;

// Text backgrounds are sized from text metrics; use the same real ones as the editor.
const measureCtx = new OffscreenCanvas(1, 1).getContext('2d');
if (measureCtx) setTextMeasurer(canvasTextMeasurer(measureCtx));

scope.onmessage = async (event: MessageEvent<ExportJob>) => {
  const job = event.data;
  try {
    const canvas = await composeInto(job.bitmap, job.doc);
    job.bitmap.close();
    const { width, height } = canvas;
    const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
    const saveBlob = job.save
      ? await canvas.convertToBlob({ type: job.save.mime, quality: job.save.quality / 100 })
      : undefined;
    const thumb = await thumbnail(canvas, job.thumbMax);
    const png = await pngBlob.arrayBuffer();
    const save = saveBlob && job.save ? await saveBlob.arrayBuffer() : undefined;
    const done: ExportDone = {
      id: job.id,
      png: { bytes: png, mime: 'image/png', width, height },
      thumb,
      ...(save && job.save ? { save: { bytes: save, mime: job.save.mime, width, height } } : {}),
    };
    const transfer = [png, thumb, ...(save ? [save] : [])];
    scope.postMessage(done, transfer);
  } catch (error) {
    const failed: ExportFailed = { id: job.id, error: String(error) };
    scope.postMessage(failed);
  }
};

async function thumbnail(source: OffscreenCanvas, max: number): Promise<ArrayBuffer> {
  const scale = Math.min(1, max / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
  return blob.arrayBuffer();
}
