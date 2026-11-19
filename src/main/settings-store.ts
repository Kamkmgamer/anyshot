import { mergeDeep } from '../shared/schema';
import { type DeepPartial, parseSettings, type Settings } from '../shared/settings';
import { readJson, writeFileAtomic } from './atomic-file';
import { paths } from './paths';
import { serialQueue } from './serial';

type Listener = (next: Settings, prev: Settings) => void;

let current: Settings = parseSettings(undefined);
const listeners = new Set<Listener>();
const serial = serialQueue();

export async function loadSettings(): Promise<Settings> {
  // A missing file (first run) means defaults; so does one that can't be read or parsed.
  const raw = await readJson(paths.settingsFile).catch((error: unknown) => {
    console.error('[settings] could not read settings; using defaults', error);
    return undefined;
  });
  current = parseSettings(raw);
  return current;
}

export function getSettings(): Settings {
  return current;
}

export function onSettingsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Applies a validated patch, persists it atomically and notifies listeners. */
export function patchSettings(
  patch: DeepPartial<Settings> | ((settings: Settings) => DeepPartial<Settings>),
): Promise<Settings> {
  return serial(async () => {
    const prev = current;
    const delta = typeof patch === 'function' ? patch(prev) : patch;
    const next = parseSettings(mergeDeep(prev, delta));
    await writeFileAtomic(paths.settingsFile, JSON.stringify(next, null, 2));
    current = next;
    for (const listener of listeners) listener(next, prev);
    return next;
  });
}
