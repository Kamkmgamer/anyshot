import '../common/ui.css';
import './hud.css';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../common/icons';
import { followTheme } from '../common/theme';
import { formatElapsed } from './clock';

export type HudPhase = 'starting' | 'recording' | 'paused' | 'finishing';

export interface HudView {
  phase: HudPhase;
  elapsedMs: number;
}

export interface HudControls {
  togglePause(): void;
  stop(): void;
}

let show: (view: HudView) => void = () => {};

function Hud({ controls, gif }: { controls: HudControls; gif: boolean }) {
  const [view, setView] = useState<HudView>({ phase: 'starting', elapsedMs: 0 });
  useEffect(() => {
    show = setView;
  }, []);
  const { phase } = view;
  const paused = phase === 'paused';
  const busy = phase === 'starting' || phase === 'finishing';
  const label =
    phase === 'finishing' ? (gif ? 'Making GIF…' : 'Saving…') : formatElapsed(view.elapsedMs);
  return (
    <div class="bar rec-hud" data-testid="recording-hud" data-phase={phase}>
      <span class={`rec-dot${paused ? ' paused' : ''}`} aria-hidden="true" />
      <span class="rec-time" data-testid="recording-time">
        {label}
      </span>
      {paused && <span class="rec-state">Paused</span>}
      <button
        type="button"
        class="tb-btn"
        data-testid="recording-pause"
        title={paused ? 'Resume recording' : 'Pause recording'}
        aria-label={paused ? 'Resume recording' : 'Pause recording'}
        disabled={busy}
        onClick={() => controls.togglePause()}
      >
        <Icon name={paused ? 'play' : 'pause'} />
      </button>
      <button
        type="button"
        class="tb-btn rec-stop"
        data-testid="recording-stop"
        title="Stop recording"
        aria-label="Stop recording"
        disabled={phase === 'finishing'}
        onClick={() => controls.stop()}
      >
        <Icon name="stop" />
      </button>
    </div>
  );
}

/** Renders the recording controls into this (recorder) window; returns how to update them. */
export function mountHud(controls: HudControls, gif: boolean): (view: HudView) => void {
  render(<Hud controls={controls} gif={gif} />, document.getElementById('root') as HTMLElement);
  followTheme();
  return (view) => show(view);
}
