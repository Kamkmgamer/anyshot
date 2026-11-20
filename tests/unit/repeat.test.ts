import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepeater, HOLD_REPEAT } from '../../src/windows/common/repeat';

describe('createRepeater', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('steps once on press and not again before the delay', () => {
    const step = vi.fn();
    const repeater = createRepeater(step);
    repeater.start();
    expect(step).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HOLD_REPEAT.delay - 1);
    expect(step).toHaveBeenCalledTimes(1);
    repeater.stop();
    vi.advanceTimersByTime(1000);
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('repeats at the interval after the delay until stopped', () => {
    const step = vi.fn();
    const repeater = createRepeater(step, { delay: 350, interval: 70 });
    repeater.start();
    vi.advanceTimersByTime(350);
    expect(step).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(70 * 4);
    expect(step).toHaveBeenCalledTimes(6);
    repeater.stop();
    vi.advanceTimersByTime(1000);
    expect(step).toHaveBeenCalledTimes(6);
  });

  it('restarting does not stack timers', () => {
    const step = vi.fn();
    const repeater = createRepeater(step, { delay: 100, interval: 50 });
    repeater.start();
    repeater.start();
    expect(step).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(100);
    expect(step).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(50);
    expect(step).toHaveBeenCalledTimes(4);
    repeater.stop();
  });
});
