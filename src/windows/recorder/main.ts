import {
  ALL_FORMATS,
  CanvasSink,
  type CropRectangle,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  MediaStreamAudioTrackSource,
  MediaStreamVideoTrackSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  StreamTarget,
  UrlSource,
  WebMOutputFormat,
} from 'mediabunny';
import type { RecorderInit, RecorderStatus } from '../../shared/ipc';
import type { GifMessage } from '../../workers/gif.worker';

// Hidden window that owns the screen stream and the encoder while recording.
// Encoded chunks go to main as they are produced and are written to disk there.

const api = window.anyshot;
const GIF_MAX_WIDTH = 800;

let stopRequested: (() => void) | null = null;
const stopped = new Promise<void>((resolve) => {
  stopRequested = resolve;
});

function report(status: RecorderStatus): void {
  void api.invoke('recorder:status', status);
}

/** Writes into a file opened by main, keeping only the current chunk in memory. */
function fileTarget(path: string, onBytes: (n: number) => void): StreamTarget {
  let size = 0;
  return new StreamTarget(
    new WritableStream({
      async write(chunk) {
        size = Math.max(size, chunk.position + chunk.data.byteLength);
        onBytes(size);
        await api.invoke('recorder:write', { path, data: chunk.data, position: chunk.position });
      },
    }),
    { chunked: true, chunkSize: 1 << 20 },
  );
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

function cropFor(init: RecorderInit, track: MediaStreamTrack): CropRectangle {
  // The stream may be scaled relative to the display's physical size.
  const settings = track.getSettings();
  const sx = (settings.width ?? init.displaySize.width) / init.displaySize.width;
  const sy = (settings.height ?? init.displaySize.height) / init.displaySize.height;
  return {
    left: Math.round(init.crop.x * sx),
    top: Math.round(init.crop.y * sy),
    width: even(init.crop.width * sx),
    height: even(init.crop.height * sy),
  };
}

async function record(init: RecorderInit): Promise<string> {
  const started = performance.now();
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: init.fps, max: init.fps } },
    audio: false,
  });
  const tracks: MediaStreamTrack[] = [...stream.getTracks()];
  try {
    const video = stream.getVideoTracks()[0];
    if (!video) throw new Error('No screen video track');
    const crop = cropFor(init, video);
    const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'vp8'], {
      width: crop.width,
      height: crop.height,
    });
    if (!codec) throw new Error('No supported video encoder (H.264, VP9 or VP8) is available');
    const mp4 = codec === 'avc';
    const path = await api.invoke('recorder:open-file', { ext: mp4 ? 'mp4' : 'webm' });
    let bytes = 0;
    const output = new Output({
      format: mp4 ? new Mp4OutputFormat() : new WebMOutputFormat(),
      target: fileTarget(path, (n) => {
        bytes = n;
      }),
    });
    const source = new MediaStreamVideoTrackSource(
      video as MediaStreamVideoTrack,
      { codec, quality: QUALITY_HIGH, transform: { crop } },
      { frameRate: init.fps },
    );
    output.addVideoTrack(source, { frameRate: init.fps });

    if (init.microphone) {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      tracks.push(...mic.getTracks());
      const audioCodec = await getFirstEncodableAudioCodec(mp4 ? ['aac', 'opus'] : ['opus']);
      const audio = mic.getAudioTracks()[0];
      if (audioCodec && audio) {
        output.addAudioTrack(
          new MediaStreamAudioTrackSource(audio as MediaStreamAudioTrack, {
            codec: audioCodec,
            quality: QUALITY_MEDIUM,
          }),
        );
      }
    }

    await output.start();
    const t0 = performance.now();
    report({ state: 'recording', elapsedMs: t0 - started, bytes: 0 });
    // A renderer-side timer is fine: this window only exists while recording.
    const ticker = setInterval(
      () => report({ state: 'recording', elapsedMs: performance.now() - t0, bytes }),
      1000,
    );
    const failure = source.errorPromise.then(() => undefined);
    await Promise.race([stopped, failure]);
    clearInterval(ticker);
    report({ state: 'finishing', elapsedMs: performance.now() - t0, bytes });
    await output.finalize();
    await api.invoke('recorder:close-file', { path, remove: false });
    return path;
  } finally {
    for (const track of tracks) track.stop();
  }
}

/** Converts the intermediate recording to a GIF, decoding and encoding frame by frame. */
async function toGif(videoPath: string, init: RecorderInit): Promise<void> {
  const gifPath = await api.invoke('recorder:open-file', { ext: 'gif' });
  const input = new Input({
    source: new UrlSource(`/@recording/${encodeURIComponent(videoPath)}`),
    formats: ALL_FORMATS,
  });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('The recording has no video');
  const scale = Math.min(1, GIF_MAX_WIDTH / track.displayWidth);
  const width = Math.max(1, Math.round(track.displayWidth * scale));
  const height = Math.max(1, Math.round(track.displayHeight * scale));
  const sink = new CanvasSink(track, { width, height, fit: 'fill', poolSize: 1 });
  const duration = await track.computeDuration();
  const step = 1 / init.fps;
  const times = Array.from(
    { length: Math.max(1, Math.floor(duration / step)) },
    (_, i) => i * step,
  );

  const worker = new Worker(new URL('../../workers/gif.worker.ts', import.meta.url), {
    type: 'module',
  });
  let position = 0;
  const encode = (message: GifMessage, transfer: Transferable[] = []) =>
    new Promise<void>((resolve, reject) => {
      worker.onmessage = async (event: MessageEvent<Uint8Array>) => {
        try {
          await api.invoke('recorder:write', { path: gifPath, data: event.data, position });
          position += event.data.byteLength;
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      worker.postMessage(message, transfer);
    });
  try {
    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      if (!wrapped) continue;
      const canvas = wrapped.canvas as OffscreenCanvas | HTMLCanvasElement;
      const ctx = canvas.getContext('2d') as
        | OffscreenCanvasRenderingContext2D
        | CanvasRenderingContext2D
        | null;
      if (!ctx) continue;
      const rgba = ctx.getImageData(0, 0, width, height).data.buffer as ArrayBuffer;
      await encode({ type: 'frame', rgba, width, height, delayMs: Math.round(step * 1000) }, [
        rgba,
      ]);
    }
    await encode({ type: 'finish' });
  } finally {
    worker.terminate();
    input.dispose();
  }
  await api.invoke('recorder:close-file', { path: gifPath, remove: false });
  await api.invoke('recorder:close-file', { path: videoPath, remove: true });
}

async function main(): Promise<void> {
  api.on('recorder:command', (command) => {
    if (command === 'stop') stopRequested?.();
  });
  const init = await api.invoke('recorder:init');
  try {
    const path = await record(init);
    if (init.gif) {
      report({ state: 'finishing', elapsedMs: 0, bytes: 0 });
      await toGif(path, init);
    }
    await api.invoke('recorder:finish', { ok: true });
  } catch (error) {
    console.error('[recorder]', error);
    await api.invoke('recorder:finish', {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

void main();
