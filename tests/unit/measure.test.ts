import { describe, expect, it } from 'vitest';
import type { Annotation } from '../../src/engine/model';
import { clampMoveDelta, measureEnd } from '../../src/engine/view';
import { clampAlong, clampPoint, snap45 } from '../../src/shared/geometry';

const image = { x: 0, y: 0, width: 300, height: 200 };
const selection = { x: 100, y: 50, width: 200, height: 100 };

describe('clampPoint', () => {
  it('keeps points inside and moves outside points to the nearest edge', () => {
    expect(clampPoint({ x: 10, y: 20 }, image)).toEqual({ x: 10, y: 20 });
    expect(clampPoint({ x: -40, y: 80 }, image)).toEqual({ x: 0, y: 80 });
    expect(clampPoint({ x: 500, y: -5 }, image)).toEqual({ x: 300, y: 0 });
    expect(clampPoint({ x: 0, y: 0 }, selection)).toEqual({ x: 100, y: 50 });
    expect(clampPoint({ x: 400, y: 400 }, selection)).toEqual({ x: 300, y: 150 });
  });
});

describe('clampAlong', () => {
  it('shortens the segment along its direction', () => {
    expect(clampAlong({ x: 100, y: 100 }, { x: 400, y: 100 }, image)).toEqual({ x: 300, y: 100 });
    expect(clampAlong({ x: 100, y: 100 }, { x: 300, y: 300 }, image)).toEqual({ x: 200, y: 200 });
    expect(clampAlong({ x: 100, y: 100 }, { x: -100, y: -300 }, image)).toEqual({ x: 50, y: 0 });
  });

  it('leaves segments that are already inside alone', () => {
    expect(clampAlong({ x: 10, y: 10 }, { x: 20, y: 30 }, image)).toEqual({ x: 20, y: 30 });
  });
});

describe('measureEnd', () => {
  it('ends at the image edge when released outside', () => {
    expect(measureEnd({ x: 50, y: 50 }, { x: 900, y: 60 }, image, false)).toEqual({
      x: 300,
      y: 60,
    });
    expect(measureEnd({ x: 150, y: 100 }, { x: 150, y: -20 }, selection, false)).toEqual({
      x: 150,
      y: 50,
    });
  });

  it('keeps the 45° direction when snapping', () => {
    const end = measureEnd({ x: 250, y: 100 }, { x: 400, y: 260 }, image, true);
    expect(end.x).toBeCloseTo(300);
    expect(end.y).toBeCloseTo(150);
  });

  it('starts from the clamped start point', () => {
    expect(measureEnd({ x: -10, y: 50 }, { x: 100, y: 50 }, image, true)).toEqual({
      x: 100,
      y: 50,
    });
  });

  it('keeps axial snapped measurements that start on an edge', () => {
    // Clamped onto the right edge, then dragged straight down with Shift.
    const down = measureEnd({ x: 300, y: 50 }, { x: 305, y: 150 }, image, true);
    expect(down.x).toBe(300);
    expect(down.y).toBeCloseTo(150, 0);
    // On the bottom edge, dragged left with Shift.
    const left = measureEnd({ x: 200, y: 200 }, { x: 60, y: 210 }, image, true);
    expect(left.y).toBe(200);
    expect(left.x).toBeCloseTo(60, 0);
  });

  it('leaves diagonal snaps unchanged', () => {
    const end = snap45({ x: 0, y: 0 }, { x: 10, y: 9 });
    expect(end.x).toBeCloseTo(end.y, 12);
    expect(end.x).not.toBe(0);
  });
});

describe('clampMoveDelta', () => {
  const stroke = { color: '#ff0000', width: 2, style: 'solid' as const };
  const measure: Annotation = {
    id: 'm',
    kind: 'measure',
    a: { x: 50, y: 50 },
    b: { x: 250, y: 100 },
    stroke,
  };
  const arrow: Annotation = { ...measure, id: 'r', kind: 'arrow' };

  it('stops a measurement at the image edge on both axes', () => {
    expect(clampMoveDelta([measure], { x: 500, y: 500 }, image)).toEqual({ x: 50, y: 100 });
    expect(clampMoveDelta([measure], { x: -500, y: -500 }, image)).toEqual({ x: -50, y: -50 });
    expect(clampMoveDelta([measure], { x: 10, y: -20 }, image)).toEqual({ x: 10, y: -20 });
  });

  it('moves the whole selection by the measurement-limited delta', () => {
    const far: Annotation = { ...measure, id: 'm2', a: { x: 280, y: 10 }, b: { x: 290, y: 20 } };
    expect(clampMoveDelta([measure, far, arrow], { x: 40, y: -30 }, image)).toEqual({
      x: 10,
      y: -10,
    });
  });

  it('lets other kinds move freely', () => {
    expect(clampMoveDelta([arrow], { x: 900, y: -900 }, image)).toEqual({ x: 900, y: -900 });
  });

  it('keeps a measurement that is already outside movable back in', () => {
    const outside: Annotation = { ...measure, a: { x: 320, y: 50 }, b: { x: 350, y: 60 } };
    expect(clampMoveDelta([outside], { x: 30, y: 0 }, image)).toEqual({ x: 0, y: 0 });
    expect(clampMoveDelta([outside], { x: -60, y: 0 }, image)).toEqual({ x: -60, y: 0 });
  });
});
