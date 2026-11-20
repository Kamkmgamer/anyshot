import '../common/ui.css';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ScrollInit } from '../../shared/ipc';
import { pointerArea } from '../../shared/stitch';
import type { StitchMessage, StitchReply } from '../../workers/stitch.worker';
import { Icon } from '../common/icons';
import { followTheme } from '../common/theme';

const api = window.anyshot;
const SAMPLE_MS = 150;

type State = {
  phase: 'starting' | 'capturing' | 'finishing';
  width: number;
  height: number;
  /** The last frames did not overlap the stitched ones (scrolled too far at once). */
  lost?: boolean;
  error?: string;
};
let setState: (s: State) => void = () => {};
let stop: ((keep: boolean) => void) | null = null;

function Hud() {
  const [state, set] = useState<State>({ phase: 'starting', width: 0, height: 0 });
  setState = set;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') stop?.(true);
      if (e.key === 'Escape') stop?.(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const label =
    state.error ??
    (state.phase === 'starting'
      ? 'Starting…'
      : state.phase === 'finishing'
        ? 'Stitching…'
        : state.lost
          ? 'Lost track · scroll back up a little'
          : `Scroll now · ${state.width} × ${state.height}`);
  return (
    <div
      class="bar"
      style={{ height: '100%', gap: '8px', padding: '0 8px', boxSizing: 'border-box' }}
    >
      <Icon name="scroll" />
      <span data-testid="scroll-status" style={{ flex: 1, fontVariantNumeric: 'tabular-nums' }}>
        {label}
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
    let finishing = false;
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
      if (data.type === 'lost-overlap') {
        // Recoverable: the stitch so far is kept, and frames match again once the
        // user scrolls back to content that overlaps it.
        busy = false;
        if (!finishing) setState({ phase: 'capturing', width: crop.width, height, lost: true });
      } else if (data.type === 'progress') {
        busy = false;
        height = data.height;
        if (!finishing) setState({ phase: 'capturing', width: data.width, height });
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
        pointer: pointerArea(spots, init.scaleFactor * sx, crop.width, crop.height),
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
    finishing = true;
    setState({ phase: 'finishing', width: crop.width, height });
    worker.postMessage({ type: 'finish' } satisfies StitchMessage);
    const done = await Promise.race([finished, failure]);
    await api.invoke(
      'scroll:finish',
      done.type === 'done'
        ? {
            image: { bytes: done.png, mime: 'image/png', width: done.width, height: done.height },
            thumb: done.thumb,
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
    setState({
      phase: 'starting',
      width: 0,
      height: 0,
      error: `Scroll capture failed: ${String(error)}`,
    });
    setTimeout(() => void api.invoke('scroll:finish', { image: null }), 3000);
  });
