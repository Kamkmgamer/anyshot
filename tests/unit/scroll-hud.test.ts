import { describe, expect, it } from 'vitest';
import { pointerInCrop } from '../../src/shared/geometry';
import { hudLabel, initialHud, onFrameReply } from '../../src/windows/scroll/status';

const progress = (height: number, full = false) =>
  ({ type: 'progress', width: 600, height, full }) as const;
const lost = { type: 'lost-overlap' } as const;

describe('scroll capture HUD', () => {
  it('shows the size while frames match', () => {
    const s = onFrameReply(initialHud, progress(400));
    expect(hudLabel(s)).toBe('Scroll now · 600 × 400');
  });

  it('ignores a single frame that missed, and says lost only when they keep missing', () => {
    let s = onFrameReply(initialHud, progress(400));
    s = onFrameReply(s, lost);
    expect(hudLabel(s)).toBe('Scroll now · 600 × 400');
    s = onFrameReply(s, lost);
    expect(hudLabel(s)).toBe('Lost track · scroll back a little');
    // The next frame that matches clears it, even when it adds no rows.
    s = onFrameReply(s, progress(400));
    expect(hudLabel(s)).toBe('Scroll now · 600 × 400');
    expect(s.misses).toBe(0);
  });

  it('says when the height limit is reached', () => {
    const s = onFrameReply(initialHud, progress(8000, true));
    expect(hudLabel(s)).toBe('Height limit · 600 × 8000');
  });

  it('keeps showing "Stitching…" once finishing', () => {
    const s = { ...onFrameReply(initialHud, progress(400)), phase: 'finishing' as const };
    expect(onFrameReply(s, lost)).toBe(s);
    expect(hudLabel(onFrameReply(s, progress(500)))).toBe('Stitching…');
  });
});

describe('pointer position in the capture crop', () => {
  const init = { scaleFactor: 1.5, crop: { x: 30, y: 60 } };
  const bounds = { x: 1920, y: 0, width: 1280, height: 720 };

  it('scales DIPs from the display origin', () => {
    expect(pointerInCrop({ x: 2020, y: 100 }, bounds, init, null)).toEqual({ x: 120, y: 90 });
  });

  it('uses physical screen pixels when given (Windows, mixed scaling)', () => {
    // A 100 % primary display left of this 150 % one: its physical origin is 1920, not 2880.
    const physical = { point: { x: 2070, y: 150 }, origin: { x: 1920, y: 0 } };
    expect(pointerInCrop({ x: 2020, y: 100 }, bounds, init, physical)).toEqual({ x: 120, y: 90 });
  });
});
