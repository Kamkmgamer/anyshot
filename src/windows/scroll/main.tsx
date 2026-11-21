import '../common/ui.css';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { screenshotDoc } from '../../engine/model';
import type { ScrollInit } from '../../shared/ipc';
import { pointerAreas } from '../../shared/stitch';
import type { StitchMessage, StitchReply } from '../../workers/stitch.worker';
import { Icon } from '../common/icons';
import { followTheme } from '../common/theme';
import { type HudState, hudLabel, initialHud, onFrameReply } from './status';

const api = window.anyshot;
const SAMPLE_MS = 150;

let update: (change: (s: HudState) => HudState) => void = () => {};
let stop: ((keep: boolean) => void) | null = null;

function Hud() {
  const [state, set] = useState<HudState>(initialHud);
  update = set;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') stop?.(true);
      if (e.key === 'Escape') stop?.(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div
      class="bar"
      style={{ height: '100%', gap: '8px', padding: '0 8px', boxSizing: 'border-box' }}
    >
      <Icon name="scroll" />
      <span data-testid="scroll-status" style={{ flex: 1, fontVariantNumeric: 'tabular-nums' }}>
        {hudLabel(state)}
      </span>
      <button
        type="button"
        class="tb-btn danger"
        title="Cancel (Esc)"
        aria-label="Cancel"
        onClick={() => stop?.(false)}
      >
        <Icon name="close" />
      </button>
      <button
        type="button"
        data-testid="scroll-stop"
        title="Finish (Enter)"
        onClick={() => stop?.(true)}
        style={{
          padding: '6px 14px',
          border: 0,
          borderRadius: '8px',
          background: 'var(--accent)',
          color: '#fff',
          font: '600 13px system-ui',
          cursor: 'pointer',
        }}
      >
        Done
      </button>
    </div>
  );
}

async function run(init: ScrollInit): Promise<void> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 10 } },
    audio: false,
  });
  try {
    await capture(stream, init);
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

async function capture(stream: MediaStream, init: ScrollInit): Promise<void> {
  const track = stream.getVideoTracks()[0];
  const video = document.getElementById('video') as HTMLVideoElement;
  video.srcObject = stream;
  await video.play();
  const settings = track?.getSettings() ?? {};
  const sx = (settings.width ?? init.displaySize.width) / init.displaySize.width;
  const sy = (settings.height ?? init.displaySize.height) / init.displaySize.height;
  const crop = {
    x: Math.round(init.crop.x * sx),
    y: Math.round(init.crop.y * sy),
    width: Math.round(init.crop.width * sx),
    height: Math.round(init.crop.height * sy),
  };
  const canvas = new OffscreenCanvas(crop.width, crop.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D context unavailable');
  const worker = new Worker(new URL('../../workers/stitch.worker.ts', import.meta.url), {
    type: 'module',
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    let busy = false;
    let height = 0;
    let fail: (error: Error) => void = () => {};
    const failure = new Promise<never>((_resolve, reject) => {
      fail = reject;
    });
    let finish: (reply: Extract<StitchReply, { type: 'done' | 'empty' }>) => void = () => {};
    const finished = new Promise<Extract<StitchReply, { type: 'done' | 'empty' }>>((resolve) => {
      finish = resolve;
    });

    worker.onerror = (event) => {
      event.preventDefault();
      fail(new Error(event.message || 'The scroll worker stopped unexpectedly.'));
    };
    worker.onmessage = ({ data }: MessageEvent<StitchReply>) => {
      if (data.type === 'failed') {
        fail(new Error(data.error));
      } else if (data.type === 'progress' || data.type === 'lost-overlap') {
        // A lost overlap is recoverable: the stitch so far is kept, and frames match
        // again once the user scrolls back to content that overlaps it.
        busy = false;
        if (data.type === 'progress') height = data.height;
        update((s) => onFrameReply(s, data));
      } else {
        finish(data);
      }
    };
    // Screen captures draw the mouse pointer in; the stitcher ignores and later repaints it.
    let spot: { x: number; y: number } | null = null;
    const sample = async () => {
      const pointer = await api.invoke('scroll:pointer');
      // Main gives it relative to the crop in display pixels; scale to stream pixels.
      const now = pointer && { x: pointer.x * sx, y: pointer.y * sy };
      ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      const rgba = ctx.getImageData(0, 0, crop.width, crop.height).data.buffer as ArrayBuffer;
      const spots = [spot, now].filter((p) => p !== null);
      spot = now;
      const message: StitchMessage = {
        type: 'frame',
        rgba,
        width: crop.width,
        height: crop.height,
        maxHeight: init.maxHeight,
        pointer: pointerAreas(spots, init.scaleFactor * sx, crop.width, crop.height),
      };
      worker.postMessage(message, [rgba]);
    };
    timer = setInterval(() => {
      if (busy || video.readyState < 2) return;
      busy = true;
      sample().catch((error) => fail(error instanceof Error ? error : new Error(String(error))));
    }, SAMPLE_MS);

    const keep = await Promise.race([
      new Promise<boolean>((resolve) => {
        stop = resolve;
      }),
      failure,
    ]);
    stop = null;
    clearInterval(timer);
    for (const track of stream.getTracks()) track.stop();
    if (!keep) {
      await api.invoke('scroll:finish', { image: null });
      return;
    }
    update((s) => ({ ...s, phase: 'finishing', width: crop.width, height }));
    const doc = screenshotDoc(init.scaleFactor * sx, init.beautify, 'scroll');
    worker.postMessage({ type: 'finish', doc } satisfies StitchMessage);
    const done = await Promise.race([finished, failure]);
    await api.invoke(
      'scroll:finish',
      done.type === 'done'
        ? {
            image: { bytes: done.png, mime: 'image/png', width: done.width, height: done.height },
            thumb: done.thumb,
            ...(done.original ? { edit: { doc, source: done.original } } : {}),
          }
        : { image: null },
    );
  } finally {
    clearInterval(timer);
    stop = null;
    worker.terminate();
  }
}

render(<Hud />, document.getElementById('root') as HTMLElement);
followTheme();
void api
  .invoke('scroll:init')
  .then(run)
  .catch((error) => {
    console.warn('[scroll]', error);
    update(() => ({ ...initialHud, error: `Scroll capture failed: ${String(error)}` }));
    setTimeout(() => void api.invoke('scroll:finish', { image: null }), 3000);
  });
