import { describe, expect, it } from 'vitest';
import { growToMinimum } from '../../src/shared/geometry';

const area = { x: 0, y: 0, width: 1920, height: 1040 };

describe('editor minimum size', () => {
  it('leaves a window that is already big enough alone', () => {
    const bounds = { x: 100, y: 80, width: 1000, height: 700 };
    expect(growToMinimum(bounds, { width: 820, height: 420 }, area)).toEqual(bounds);
  });

  it('grows a narrow window to the minimum, rounding up', () => {
    expect(
      growToMinimum(
        { x: 100, y: 80, width: 640, height: 420 },
        { width: 787.1, height: 400 },
        area,
      ),
    ).toEqual({ x: 100, y: 80, width: 788, height: 420 });
  });

  it('moves a grown window back into the work area', () => {
    expect(
      growToMinimum(
        { x: 1500, y: 900, width: 400, height: 300 },
        { width: 800, height: 500 },
        area,
      ),
    ).toEqual({ x: 1120, y: 540, width: 800, height: 500 });
  });

  it('never grows past the work area, on a second display too', () => {
    const small = { x: 1920, y: 0, width: 700, height: 500 };
    expect(
      growToMinimum(
        { x: 2000, y: 50, width: 500, height: 300 },
        { width: 900, height: 600 },
        small,
      ),
    ).toEqual({ x: 1920, y: 0, width: 700, height: 500 });
  });
});
