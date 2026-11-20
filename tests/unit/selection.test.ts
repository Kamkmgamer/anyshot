import { describe, expect, it } from 'vitest';
import {
  flippedHandle,
  moveSelection,
  placeToolbar,
  popoverSide,
  resizeSelection,
  toImageRegion,
} from '../../src/shared/selection';

const screen = { width: 1000, height: 800 };
const sel = { x: 100, y: 100, width: 200, height: 100 };

describe('selection math', () => {
  it('resizes from each kind of handle', () => {
    expect(resizeSelection(sel, 'se', { x: 400, y: 300 }, screen)).toEqual({
      x: 100,
      y: 100,
      width: 300,
      height: 200,
    });
    expect(resizeSelection(sel, 'n', { x: 999, y: 50 }, screen)).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 150,
    });
    expect(resizeSelection(sel, 'w', { x: 0, y: 0 }, screen)).toEqual({
      x: 0,
      y: 100,
      width: 300,
      height: 100,
    });
  });

  it('normalises when dragged past the opposite edge, and reports the flipped handle', () => {
    const p = { x: 50, y: 150 };
    expect(resizeSelection(sel, 'e', p, screen)).toEqual({ x: 50, y: 100, width: 50, height: 100 });
    expect(flippedHandle(sel, 'e', p)).toBe('w');
    expect(flippedHandle(sel, 'se', { x: 50, y: 50 })).toBe('nw');
  });

  it('clamps resize and move to the display', () => {
    expect(resizeSelection(sel, 'se', { x: 5000, y: -10 }, screen)).toEqual({
      x: 100,
      y: 0,
      width: 900,
      height: 100,
    });
    expect(moveSelection(sel, 5000, -5000, screen)).toEqual({
      x: 800,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  it('maps CSS pixels to whole image pixels inside the frame', () => {
    expect(
      toImageRegion({ x: 10.2, y: 5.6, width: 100, height: 50 }, 2, { width: 400, height: 300 }),
    ).toEqual({
      x: 20,
      y: 11,
      width: 200,
      height: 100,
    });
    expect(
      toImageRegion({ x: 190, y: 140, width: 100, height: 100 }, 2, { width: 400, height: 300 }),
    ).toEqual({
      x: 380,
      y: 280,
      width: 20,
      height: 20,
    });
  });

  it('places toolbars outside the selection when there is room, inside otherwise', () => {
    expect(placeToolbar(sel, { width: 100, height: 40 }, screen, 'below')).toEqual({
      x: 150,
      y: 208,
    });
    const low = { x: 100, y: 700, width: 200, height: 95 };
    expect(placeToolbar(low, { width: 100, height: 40 }, screen, 'below').y).toBe(652);
    const full = { x: 0, y: 0, width: 1000, height: 800 };
    expect(placeToolbar(full, { width: 100, height: 40 }, screen, 'below').y).toBe(752);
    expect(placeToolbar(sel, { width: 44, height: 300 }, screen, 'right')).toEqual({
      x: 308,
      y: 100,
    });
  });
});

describe('popover placement', () => {
  it('opens below the bar when it fits, above when only that fits', () => {
    const bar = { top: 500, bottom: 580 };
    expect(popoverSide(bar, 200, 800)).toBe('below');
    expect(popoverSide(bar, 260, 800)).toBe('above');
    // Fits neither way: below, as before.
    expect(popoverSide({ top: 100, bottom: 180 }, 700, 800)).toBe('below');
  });
});
