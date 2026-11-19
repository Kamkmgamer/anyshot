import { mergeDeep } from '../shared/schema';
import { type DeepPartial, parseSettings, type Settings } from '../shared/settings';
import { readJson, writeFileAtomic } from './atomic-file';
import { paths } from './paths';

type Listener = (next: Settings, prev: Settings) => void;

let current: Settings = parseSettings(undefined);
const listeners = new Set<Listener>();
let writeChain: Promise<void> = Promise.resolve();

export async function loadSettings(): Promise<Settings> {
  current = parseSettings(await readJson(paths.settingsFile));
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
export async function patchSettings(patch: DeepPartial<Settings>): Promise<Settings> {
  const prev = current;
  current = parseSettings(mergeDeep(current, patch));
  const snapshot = JSON.stringify(current, null, 2);
  // Serialise writes so an older snapshot can never land after a newer one.
  writeChain = writeChain
    .then(() => writeFileAtomic(paths.settingsFile, snapshot))
    .catch((error) => {
      console.error('[settings] write failed', error);
    });
  await writeChain;
  for (const listener of listeners) listener(current, prev);
  return current;
}
