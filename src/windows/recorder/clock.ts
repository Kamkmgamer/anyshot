/** Recording time: runs from `start()`, stands still while paused. */
export interface RecordingClock {
  start(): void;
  /** Returns false if already paused or not started. */
  pause(): boolean;
  /** Returns false if not paused. */
  resume(): boolean;
  readonly paused: boolean;
  /** Recorded milliseconds so far, without the paused stretches. */
  elapsed(): number;
}

export function createClock(now: () => number = () => performance.now()): RecordingClock {
  let startedAt: number | null = null;
  let pausedAt: number | null = null;
  let pausedTotal = 0;
  return {
    start() {
      startedAt = now();
      pausedAt = null;
      pausedTotal = 0;
    },
    pause() {
      if (startedAt === null || pausedAt !== null) return false;
      pausedAt = now();
      return true;
    },
    resume() {
      if (pausedAt === null) return false;
      pausedTotal += now() - pausedAt;
      pausedAt = null;
      return true;
    },
    get paused() {
      return pausedAt !== null;
    },
    elapsed() {
      if (startedAt === null) return 0;
      return (pausedAt ?? now()) - startedAt - pausedTotal;
    },
  };
}

/** 0:07, 1:05, 1:02:03. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}
