/// <reference lib="webworker" />
import { Stitcher } from '../shared/stitch';

export type StitchMessage =
  | { type: 'frame'; rgba: ArrayBuffer; width: number; height: number; maxHeight: number }
  | { type: 'finish' };

export type StitchReply =
  | { type: 'progress'; width: number; height: number }
  | { type: 'done'; png: ArrayBuffer; thumb: ArrayBuffer; width: number; height: number }
  | { type: 'empty' }
  | { type: 'lost-overlap' };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let stitcher: Stitcher | null = null;

scope.onmessage = async (event: MessageEvent<StitchMessage>) => {
  const message = event.data;
  if (message.type === 'frame') {
    stitcher ??= new Stitcher(message.width, message.height, message.maxHeight);
    const rows = stitcher.push({
      data: new Uint8ClampedArray(message.rgba),
      width: message.width,
      height: message.height,
    });
    const reply: StitchReply =
      rows === null
        ? { type: 'lost-overlap' }
        : { type: 'progress', width: stitcher.width, height: stitcher.height };
    scope.postMessage(reply);
    return;
  }
  if (!stitcher) {
    scope.postMessage({ type: 'empty' } satisfies StitchReply);
    return;
  }
  const result = stitcher.result();
  const canvas = new OffscreenCanvas(result.width, result.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.putImageData(
    new ImageData(result.data as Uint8ClampedArray<ArrayBuffer>, result.width, result.height),
    0,
    0,
  );
  const png = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
  const scale = Math.min(1, 480 / Math.max(result.width, result.height));
  const small = new OffscreenCanvas(
    Math.max(1, Math.round(result.width * scale)),
    Math.max(1, Math.round(result.height * scale)),
  );
  small.getContext('2d')?.drawImage(canvas, 0, 0, small.width, small.height);
  const thumb = await (
    await small.convertToBlob({ type: 'image/webp', quality: 0.82 })
  ).arrayBuffer();
  const reply: StitchReply = {
    type: 'done',
    png,
    thumb,
    width: result.width,
    height: result.height,
  };
  scope.postMessage(reply, [png, thumb]);
};
