/// <reference lib="webworker" />
import { applyPalette, GIFEncoder, quantize } from 'gifenc';

export type GifMessage =
  | { type: 'frame'; rgba: ArrayBuffer; width: number; height: number; delayMs: number }
  | { type: 'finish' };

/** Encodes one GIF frame at a time and hands the bytes straight back, so nothing accumulates here. */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const gif = GIFEncoder();

scope.onmessage = (event: MessageEvent<GifMessage>) => {
  const message = event.data;
  if (message.type === 'frame') {
    const rgba = new Uint8ClampedArray(message.rgba);
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, message.width, message.height, { palette, delay: message.delayMs });
  } else {
    gif.finish();
  }
  const bytes = gif.bytesView().slice();
  gif.reset();
  scope.postMessage(bytes, [bytes.buffer]);
};
