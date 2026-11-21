/// <reference lib="webworker" />
import { frameImage } from '../engine/beautify';
import type { Doc } from '../engine/model';
import type { EncodedImage } from '../shared/ipc';
import { type Area, Stitcher } from '../shared/stitch';

export type StitchMessage =
  | {
      type: 'frame';
      rgba: ArrayBuffer;
      width: number;
      height: number;
      maxHeight: number;
      /** Where the mouse pointer may be drawn in this frame (none when it is outside). */
      pointer: Area[];
    }
  | { type: 'finish'; doc: Doc };

export type StitchReply =
  | { type: 'progress'; width: number; height: number; full: boolean }
  | {
      type: 'done';
      png: ArrayBuffer;
      thumb: ArrayBuffer;
      width: number;
      height: number;
      original?: EncodedImage;
    }
  | { type: 'empty' }
  | { type: 'failed'; error: string }
  | { type: 'lost-overlap' };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let stitcher: Stitcher | null = null;

scope.onmessage = async (event: MessageEvent<StitchMessage>) => {
  const message = event.data;
  if (message.type === 'frame') {
    stitcher ??= new Stitcher(message.width, message.height, message.maxHeight);
    const rows = stitcher.push(
      { data: new Uint8ClampedArray(message.rgba), width: message.width, height: message.height },
      message.pointer,
    );
    const reply: StitchReply =
      rows === null
        ? { type: 'lost-overlap' }
        : {
            type: 'progress',
            width: stitcher.width,
            height: stitcher.height,
            full: stitcher.full,
          };
    scope.postMessage(reply);
    return;
  }
  if (!stitcher) {
    scope.postMessage({ type: 'empty' } satisfies StitchReply);
    return;
  }
  try {
    const reply = await finish(stitcher, message.doc);
    scope.postMessage(reply, [
      reply.png,
      reply.thumb,
      ...(reply.original ? [reply.original.bytes] : []),
    ]);
  } catch (error) {
    scope.postMessage({
      type: 'failed',
      error: error instanceof Error ? error.message : String(error),
    } satisfies StitchReply);
  }
};

async function finish(
  stitcher: Stitcher,
  doc: Doc,
): Promise<Extract<StitchReply, { type: 'done' }>> {
  const result = stitcher.result();
  const canvas = new OffscreenCanvas(result.width, result.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.putImageData(
    new ImageData(result.data as Uint8ClampedArray<ArrayBuffer>, result.width, result.height),
    0,
    0,
  );
  const png = await pngBytes(canvas);
  const { beautify } = doc.effects;
  if (beautify.enabled) {
    try {
      const framed = await frameImage(canvas, beautify, doc.unit);
      const original: EncodedImage = {
        bytes: png,
        mime: 'image/png',
        width: result.width,
        height: result.height,
      };
      return await encodeResult(framed, await pngBytes(framed), original);
    } catch {
      // Adding padding can exceed the canvas limit even though the stitch fits.
    }
  }
  return encodeResult(canvas, png);
}

async function encodeResult(
  out: OffscreenCanvas,
  png: ArrayBuffer,
  original?: EncodedImage,
): Promise<Extract<StitchReply, { type: 'done' }>> {
  const scale = Math.min(1, 480 / Math.max(out.width, out.height));
  const small = new OffscreenCanvas(
    Math.max(1, Math.round(out.width * scale)),
    Math.max(1, Math.round(out.height * scale)),
  );
  small.getContext('2d')?.drawImage(out, 0, 0, small.width, small.height);
  const thumb = await (
    await small.convertToBlob({ type: 'image/webp', quality: 0.82 })
  ).arrayBuffer();
  return {
    type: 'done',
    png,
    thumb,
    width: out.width,
    height: out.height,
    ...(original ? { original } : {}),
  };
}

async function pngBytes(canvas: OffscreenCanvas): Promise<ArrayBuffer> {
  return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}
