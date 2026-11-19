import '../common/ui.css';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ScrollInit } from '../../shared/ipc';
import type { StitchMessage, StitchReply } from '../../workers/stitch.worker';
import { Icon } from '../common/icons';
import { applyTheme } from '../common/theme';

const api = window.anyshot;
const SAMPLE_MS = 150;

type State = {
  phase: 'starting' | 'capturing' | 'finishing';
  width: number;
  height: number;
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
  let height = 0;
  worker.onmessage = (event: MessageEvent<StitchReply>) => {
    if (event.data.type === 'progress') {
      height = event.data.height;
      setState({ phase: 'capturing', width: event.data.width, height });
    }
  };
  let busy = false;
  // A renderer timer is fine: this window exists only during the capture.
  const timer = setInterval(() => {
    if (busy || video.readyState < 2) return;
    busy = true;
    ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const rgba = ctx.getImageData(0, 0, crop.width, crop.height).data.buffer as ArrayBuffer;
    const message: StitchMessage = {
      type: 'frame',
      rgba,
      width: crop.width,
      height: crop.height,
      maxHeight: init.maxHeight,
    };
    worker.postMessage(message, [rgba]);
    busy = false;
  }, SAMPLE_MS);

  const keep = await new Promise<boolean>((resolve) => {
    stop = resolve;
  });
  clearInterval(timer);
  for (const t of stream.getTracks()) t.stop();
  if (!keep || height === 0) {
    worker.terminate();
    await api.invoke('scroll:finish', { image: null });
    return;
  }
  setState({ phase: 'finishing', width: crop.width, height });
  const done = await new Promise<StitchReply>((resolve) => {
    worker.onmessage = (event: MessageEvent<StitchReply>) => {
      if (event.data.type !== 'progress') resolve(event.data);
    };
    worker.postMessage({ type: 'finish' } satisfies StitchMessage);
  });
  worker.terminate();
  if (done.type !== 'done') {
    await api.invoke('scroll:finish', { image: null });
    return;
  }
  await api.invoke('scroll:finish', {
    image: { bytes: done.png, mime: 'image/png', width: done.width, height: done.height },
    thumb: done.thumb,
  });
}

render(<Hud />, document.getElementById('root') as HTMLElement);
void api.invoke('settings:get').then(applyTheme);
void api
  .invoke('scroll:init')
  .then(run)
  .catch((error) => {
    console.error('[scroll]', error);
    setState({
      phase: 'starting',
      width: 0,
      height: 0,
      error: `Scroll capture failed: ${String(error)}`,
    });
    setTimeout(() => void api.invoke('scroll:finish', { image: null }), 3000);
  });
