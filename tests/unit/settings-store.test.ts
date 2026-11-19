import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ path: '' }));
vi.mock('../../src/main/paths', () => ({
  paths: {
    get settingsFile() {
      return state.path;
    },
  },
}));

let dir: string;
let store: typeof import('../../src/main/settings-store');
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'anyshot-settings-'));
  state.path = join(dir, 'settings.json');
  vi.resetModules();
  store = await import('../../src/main/settings-store');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it('applies concurrent patches in order and publishes each persisted value', async () => {
  const observed: number[] = [];
  store.onSettingsChanged((next) => observed.push(next.output.historySize));
  const [first, second] = await Promise.all([
    store.patchSettings({ output: { historySize: 5 } }),
    store.patchSettings((settings) => ({
      output: { historySize: settings.output.historySize + 1 },
    })),
  ]);
  expect(first.output.historySize).toBe(5);
  expect(second.output.historySize).toBe(6);
  expect(observed).toEqual([5, 6]);
  expect(JSON.parse(await readFile(state.path, 'utf8'))).toEqual(second);
});

it('reports a failed write without publishing it and keeps the queue usable', async () => {
  const initial = store.getSettings();
  const listener = vi.fn();
  store.onSettingsChanged(listener);
  await mkdir(state.path);
  await expect(store.patchSettings({ output: { saveDir: '/failed' } })).rejects.toThrow();
  expect(store.getSettings()).toBe(initial);
  expect(listener).not.toHaveBeenCalled();
  await rm(state.path, { recursive: true });
  const next = await store.patchSettings({ output: { historySize: 10 } });
  expect(next.output.saveDir).toBe(initial.output.saveDir);
  expect(listener).toHaveBeenCalledExactlyOnceWith(next, initial);
});
