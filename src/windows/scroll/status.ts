import type { StitchReply } from '../../workers/stitch.worker';

/** What the scroll-capture HUD shows. */
export interface HudState {
  phase: 'starting' | 'capturing' | 'finishing';
  width: number;
  height: number;
  /** Frames in a row that did not overlap the stitch (scrolled too far between samples). */
  misses: number;
  /** The stitch reached the height limit; scrolling further adds nothing. */
  full: boolean;
  error?: string;
}

/**
 * One frame that didn't match is usually a passing glitch (an animation, a
 * repaint mid-scroll); the HUD only says it lost track when frames keep missing.
 */
export const LOST_AFTER = 2;

export const initialHud: HudState = {
  phase: 'starting',
  width: 0,
  height: 0,
  misses: 0,
  full: false,
};

/** The HUD state after the stitcher's reply to a frame. */
export function onFrameReply(
  state: HudState,
  reply: Extract<StitchReply, { type: 'progress' | 'lost-overlap' }>,
): HudState {
  if (state.phase === 'finishing') return state;
  if (reply.type === 'lost-overlap')
    return { ...state, phase: 'capturing', misses: state.misses + 1 };
  return {
    ...state,
    phase: 'capturing',
    width: reply.width,
    height: reply.height,
    full: reply.full,
    misses: 0,
  };
}

export function hudLabel(state: HudState): string {
  if (state.error) return state.error;
  if (state.phase === 'starting') return 'Starting…';
  if (state.phase === 'finishing') return 'Stitching…';
  if (state.misses >= LOST_AFTER) return 'Lost track · scroll back a little';
  const size = `${state.width} × ${state.height}`;
  return state.full ? `Height limit · ${size}` : `Scroll now · ${size}`;
}
