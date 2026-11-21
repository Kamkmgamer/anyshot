import { describe, expect, it } from 'vitest';
import { outsideFrame, placeBeside } from '../../src/shared/geometry';
import { createClock, formatElapsed } from '../../src/windows/recorder/clock';
import { createPauseGate } from '../../src/windows/recorder/pause-gate';

describe('recording clock', () => {
  it('counts recorded time and stands still while paused', () => {
    let t = 1000;
    const clock = createClock(() => t);
    expect(clock.elapsed()).toBe(0);
    clock.start();
    t += 2000;
    expect(clock.elapsed()).toBe(2000);
    expect(clock.pause()).toBe(true);
    expect(clock.pause()).toBe(false);
    t += 5000;
    expect(clock.paused).toBe(true);
    expect(clock.elapsed()).toBe(2000);
    expect(clock.resume()).toBe(true);
    expect(clock.resume()).toBe(false);
    t += 1500;
    expect(clock.elapsed()).toBe(3500);
  });

  it('does not pause before it starts', () => {
    const clock = createClock(() => 0);
    expect(clock.pause()).toBe(false);
    expect(clock.paused).toBe(false);
  });

  it('formats minutes and hours', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(7_900)).toBe('0:07');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});

describe('placeBeside', () => {
  const work = { x: 0, y: 0, width: 1920, height: 1040 };
  const size = { width: 200, height: 40 };

  it('goes below the area, centred', () => {
    expect(placeBeside({ x: 100, y: 100, width: 400, height: 200 }, size, 10, work)).toEqual({
      x: 200,
      y: 310,
    });
  });

  it('goes above when there is no room below, then right, then left', () => {
    expect(placeBeside({ x: 100, y: 900, width: 400, height: 130 }, size, 10, work)).toEqual({
      x: 200,
      y: 850,
    });
    expect(placeBeside({ x: 0, y: 0, width: 1500, height: 1040 }, size, 10, work)).toEqual({
      x: 1510,
      y: 500,
    });
    expect(placeBeside({ x: 400, y: 0, width: 1520, height: 1040 }, size, 10, work)).toEqual({
      x: 190,
      y: 500,
    });
  });

  it('keeps the panel on the display when the area is near an edge', () => {
    expect(placeBeside({ x: 0, y: 100, width: 50, height: 50 }, size, 10, work)).toEqual({
      x: 0,
      y: 160,
    });
  });

  it('is null when the area leaves no room on any side', () => {
    expect(placeBeside(work, size, 10, work)).toBeNull();
  });

  it('works on a second display', () => {
    const second = { x: 1920, y: 0, width: 1280, height: 1024 };
    expect(placeBeside({ x: 2020, y: 100, width: 400, height: 200 }, size, 10, second)).toEqual({
      x: 2120,
      y: 310,
    });
  });
});

describe('outsideFrame', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };

  it('grows the area by the line width on every side', () => {
    expect(outsideFrame({ x: 100, y: 100, width: 400, height: 200 }, 2, display)).toEqual({
      x: 98,
      y: 98,
      width: 404,
      height: 204,
    });
  });

  it('still frames an area at an edge, but not one that covers the display', () => {
    expect(outsideFrame({ x: 0, y: 0, width: 400, height: 200 }, 2, display)).toEqual({
      x: -2,
      y: -2,
      width: 404,
      height: 204,
    });
    expect(outsideFrame(display, 2, display)).toBeNull();
  });
});

describe('pause gate', () => {
  it('holds requests until it opens, then applies the last one', () => {
    const applied: boolean[] = [];
    const gate = createPauseGate((pause) => applied.push(pause));
    gate.request(true);
    gate.request(false);
    gate.request(true);
    expect(gate.pending).toBe(true);
    expect(applied).toEqual([]);
    gate.open();
    expect(applied).toEqual([true]);
    expect(gate.pending).toBeNull();
    gate.request(false);
    expect(applied).toEqual([true, false]);
  });

  it('applies nothing on opening when nothing was asked', () => {
    const applied: boolean[] = [];
    const gate = createPauseGate((pause) => applied.push(pause));
    gate.open();
    gate.open();
    expect(applied).toEqual([]);
  });

  it('drops held and later requests once closed', () => {
    const applied: boolean[] = [];
    const gate = createPauseGate((pause) => applied.push(pause));
    gate.request(true);
    gate.close();
    gate.open();
    gate.request(true);
    expect(applied).toEqual([]);
    expect(gate.pending).toBeNull();
  });
});
