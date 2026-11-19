import { app } from 'electron';
import type { AppAction } from './cli';
import { frameCount } from './frames';
import { getSettings } from './settings-store';
import { allWindows } from './windows';

export interface TestHooks {
  dispatch(action: AppAction, file?: string): void;
  windows(): { kind: string; visible: boolean; bounds: Electron.Rectangle }[];
  processTypes(): string[];
  frameCount(): number;
  settings(): unknown;
  timings: Record<string, number[]>;
}

declare global {
  var __anyshot: TestHooks | undefined;
}

/** Exposed only when ANYSHOT_TEST=1, for Playwright's `app.evaluate`. */
export function installTestHooks(dispatch: (action: AppAction, file?: string) => void): void {
  globalThis.__anyshot = {
    dispatch,
    windows: () =>
      allWindows()
        .filter(({ win }) => !win.isDestroyed())
        .map(({ kind, win }) => ({ kind, visible: win.isVisible(), bounds: win.getBounds() })),
    processTypes: () => app.getAppMetrics().map((m) => m.type),
    frameCount,
    settings: getSettings,
    timings: {},
  };
}

export function recordTiming(name: string, ms: number): void {
  const hooks = globalThis.__anyshot;
  if (!hooks) return;
  const list = hooks.timings[name] ?? [];
  list.push(ms);
  hooks.timings[name] = list;
}
