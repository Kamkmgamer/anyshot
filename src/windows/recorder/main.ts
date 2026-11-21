import {
  ALL_FORMATS,
  BufferSource,
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
  QUALITY_LOW,
  QUALITY_MEDIUM,
  StreamTarget,
  WebMOutputFormat,
} from 'mediabunny';
import type { RecorderInit, RecorderStatus } from '../../shared/ipc';
import type { GifMessage } from '../../workers/gif.worker';
import { createClock } from './clock';
import { type HudView, mountHud } from './hud';
import { createPauseGate, type PauseGate } from './pause-gate';

// The window that owns the screen stream and the encoder while recording, and shows
// the recording controls beside the area (main shows it once capture has started).
// Encoded chunks go to main as they are produced and are written to disk there.

const api = window.anyshot;
const GIF_MAX_WIDTH = 800;
const VIDEO_QUALITY = { compact: QUALITY_LOW, standard: QUALITY_MEDIUM, high: QUALITY_HIGH };
/** How often the controls' clock updates. */
const HUD_TICK_MS = 250;
/** How long a pause waits for every track's first sample before it goes ahead anyway. */
const FIRST_SAMPLE_WAIT_MS = 1000;

let stopRequested: (() => void) | null = null;
const stopped = new Promise<void>((resolve) => {
  stopRequested = resolve;
});

const clock = createClock();
/** Pauses or resumes the running recording; set while one runs. */
let pauseGate: PauseGate | null = null;
let showHud: (view: HudView) => void = () => {};

function report(status: RecorderStatus): void {
  void api.invoke('recorder:status', status);
}

function hudView(): HudView {
  return { phase: clock.paused ? 'paused' : 'recording', elapsedMs: clock.elapsed() };
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

/** Resolves when the track delivers its first frame or audio data, or ends. Stops the track. */
async function firstSample(track: MediaStreamTrack): Promise<void> {
  try {
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    const { value } = await reader.read();
    value?.close();
    void reader.cancel();
  } catch (error) {
    console.warn('[recorder] could not watch for the first sample', error);
  } finally {
    track.stop();
  }
}

/** Mixes computer audio and the microphone into one track (a file takes one audio track). */
function mixAudio(sources: MediaStreamTrack[]): { track: MediaStreamTrack; close: () => void } {
  const context = new AudioContext();
  const mix = context.createMediaStreamDestination();
  for (const source of sources)
    context.createMediaStreamSource(new MediaStream([source])).connect(mix);
  const track = mix.stream.getAudioTracks()[0];
  if (!track) throw new Error('Could not mix the audio');
  return { track, close: () => void context.close() };
}

async function record(init: RecorderInit): Promise<string> {
  const started = performance.now();
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: init.fps, max: init.fps } },
    // Computer audio comes with the display stream (main answers with Windows loopback).
    audio: init.systemAudio,
  });
  const tracks: MediaStreamTrack[] = [...stream.getTracks()];
  let closeMix = () => {};
  try {
    const video = stream.getVideoTracks()[0];
    if (!video) throw new Error('No screen video track');
    const crop = cropFor(init, video);
    const quality = VIDEO_QUALITY[init.quality];
    const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'vp8'], {
      width: crop.width,
      height: crop.height,
      quality,
      frameRate: init.fps,
    });
    if (!codec) throw new Error('No supported video encoder (H.264, VP9 or VP8) is available');
    const mp4 = codec === 'avc';
    const audioTracks = stream.getAudioTracks();
    if (init.systemAudio && audioTracks.length === 0) {
      // Recording still goes ahead, just without computer audio.
      console.warn('[recorder] computer audio was requested but the stream has none');
    }
    if (init.microphone) {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      tracks.push(...mic.getTracks());
      const audio = mic.getAudioTracks()[0];
      if (!audio) throw new Error('No microphone audio track');
      audioTracks.push(audio);
    }
    let audioSource: MediaStreamAudioTrackSource | undefined;
    let audio: MediaStreamTrack | undefined = audioTracks[0];
    if (audio) {
      if (audioTracks.length > 1) {
        const mixed = mixAudio(audioTracks);
        tracks.push(mixed.track);
        closeMix = mixed.close;
        audio = mixed.track;
      }
      const audioCodec = await getFirstEncodableAudioCodec(mp4 ? ['aac', 'opus'] : ['opus']);
      if (!audioCodec) throw new Error('No supported audio encoder is available');
      audioSource = new MediaStreamAudioTrackSource(audio as MediaStreamAudioTrack, {
        codec: audioCodec,
        quality: QUALITY_MEDIUM,
      });
    }
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
      { codec, quality, transform: { crop } },
      { frameRate: init.fps },
    );
    output.addVideoTrack(source, { frameRate: init.fps });

    if (audioSource) output.addAudioTrack(audioSource);

    await output.start();
    // Clones get the same frames as the sources, from now on, so a clone's first sample
    // means its source has started too.
    const clones = [video, audio].flatMap((track) => (track ? [track.clone()] : []));
    tracks.push(...clones);
    const tracksStarted = Promise.race([
      Promise.all(clones.map(firstSample)),
      new Promise((resolve) => setTimeout(resolve, FIRST_SAMPLE_WAIT_MS)),
    ]);
    clock.start();
    // The first report's time is how long capture took to start.
    report({ state: 'recording', elapsedMs: performance.now() - started, bytes: 0 });
    const state = () => (clock.paused ? 'paused' : 'recording');
    const gate = createPauseGate((pause) => {
      // Paused sources drop what the stream sends, and the next timestamps continue
      // from where they stopped, so the file has no gap.
      if (pause ? !clock.pause() : !clock.resume()) return;
      for (const media of [source, audioSource]) {
        if (pause) media?.pause();
        else media?.resume();
      }
      report({ state: state(), elapsedMs: clock.elapsed(), bytes });
      showHud(hudView());
    });
    // A source paused before its first sample places that sample after the paused time,
    // out of step with the other track, so pauses wait until every track has started.
    pauseGate = gate;
    void tracksStarted.then(() => gate.open());
    // Renderer-side timers are fine: this window only exists while recording.
    const ticker = setInterval(
      () => report({ state: state(), elapsedMs: clock.elapsed(), bytes }),
      1000,
    );
    const hudTicker = setInterval(() => showHud(hudView()), HUD_TICK_MS);
    showHud(hudView());
    const failure = source.errorPromise.then(() => undefined);
    try {
      await Promise.race([stopped, failure]);
    } finally {
      clearInterval(ticker);
      clearInterval(hudTicker);
      gate.close();
      pauseGate = null;
    }
    report({ state: 'finishing', elapsedMs: clock.elapsed(), bytes });
    showHud({ phase: 'finishing', elapsedMs: clock.elapsed() });
    await output.finalize();
    await api.invoke('recorder:close-file', { path });
    return path;
  } finally {
    for (const track of tracks) track.stop();
    closeMix();
  }
}

/** Converts the intermediate recording to a GIF, decoding and encoding frame by frame. */
async function toGif(videoPath: string, init: RecorderInit): Promise<void> {
  const gifPath = await api.invoke('recorder:open-file', { ext: 'gif' });
  // Read in one request: UrlSource reads ahead, and disposing it aborts those requests.
  const response = await fetch(`/@recording/${encodeURIComponent(videoPath)}`);
  if (!response.ok) throw new Error(`Could not read the recording (${response.status})`);
  const input = new Input({
    source: new BufferSource(await response.arrayBuffer()),
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
  let frame = 0;
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
      worker.onerror = (event) => {
        event.preventDefault();
        reject(new Error(event.message || 'The GIF worker stopped unexpectedly.'));
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
      // GIF stores centiseconds. Round cumulative time to avoid drift.
      const start = Math.round((frame * 100) / init.fps);
      const end = Math.round(((frame + 1) * 100) / init.fps);
      await encode({ type: 'frame', rgba, width, height, delayMs: (end - start) * 10 }, [rgba]);
      frame++;
    }
    await encode({ type: 'finish' });
  } finally {
    worker.terminate();
    input.dispose();
  }
  await api.invoke('recorder:close-file', { path: gifPath });
}

/** Pauses or resumes, counting a request still held for the tracks to start. */
function togglePause(): void {
  pauseGate?.request(!(pauseGate.pending ?? clock.paused));
}

async function main(): Promise<void> {
  api.on('recorder:command', (command) => {
    if (command === 'stop') stopRequested?.();
    else if (command === 'toggle') togglePause();
    else pauseGate?.request(command === 'pause');
  });
  const init = await api.invoke('recorder:init');
  showHud = mountHud(
    {
      togglePause,
      stop: () => stopRequested?.(),
    },
    init.gif,
  );
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
