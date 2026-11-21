/** Holds pause and resume requests until it opens, then passes them straight through. */
export interface PauseGate {
  /** Asks to pause (true) or resume (false). */
  request(pause: boolean): void;
  /** The last request held while closed, if any. */
  readonly pending: boolean | null;
  /** Applies the held request, if any, and passes later ones straight through. */
  open(): void;
  /** Drops the held request and ignores later ones. */
  close(): void;
}

export function createPauseGate(apply: (pause: boolean) => void): PauseGate {
  let state: 'waiting' | 'open' | 'closed' = 'waiting';
  let pending: boolean | null = null;
  return {
    request(pause) {
      if (state === 'open') apply(pause);
      else if (state === 'waiting') pending = pause;
    },
    get pending() {
      return pending;
    },
    open() {
      if (state !== 'waiting') return;
      state = 'open';
      const held = pending;
      pending = null;
      if (held !== null) apply(held);
    },
    close() {
      state = 'closed';
      pending = null;
    },
  };
}
