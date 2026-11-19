import { useEffect, useMemo, useRef } from 'preact/hooks';

/** Press-and-hold timing: one step at once, then repeats after a pause. */
export const HOLD_REPEAT = { delay: 350, interval: 70 };

export interface Repeater {
  /** Runs one step now and keeps repeating until `stop`. */
  start(): void;
  stop(): void;
}

export function createRepeater(step: () => void, timing = HOLD_REPEAT): Repeater {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    step();
    timer = setTimeout(tick, timing.interval);
  };
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    start() {
      stop();
      step();
      timer = setTimeout(tick, timing.delay);
    },
    stop,
  };
}

/**
 * Button props that repeat `step` while the button is held. A click still runs
 * one step, and so does keyboard activation (Enter/Space), which fires a click
 * without a pointer press.
 */
export function usePressRepeat(step: () => void) {
  const latest = useRef(step);
  latest.current = step;
  const repeater = useMemo(() => createRepeater(() => latest.current()), []);
  useEffect(() => {
    const stop = () => repeater.stop();
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('blur', stop);
      repeater.stop();
    };
  }, [repeater]);
  const stop = () => repeater.stop();
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.button === 0) repeater.start();
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    // detail is 0 for clicks from the keyboard; pointer clicks already stepped on press.
    onClick: (e: MouseEvent) => {
      if (e.detail === 0) latest.current();
    },
  };
}
