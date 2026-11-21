import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { MAX_BACKGROUNDS, parseCustomBackground, type SavedBackground } from '../shared/background';
import { isRecord } from '../shared/schema';
import { readJson, writeFileAtomic } from './atomic-file';
import { handle } from './ipc';
import { paths } from './paths';
import { serialQueue } from './serial';
import { broadcast } from './windows';

const serial = serialQueue();
const file = () => join(paths.userData, 'backgrounds.json');

async function readBackgrounds(): Promise<SavedBackground[]> {
  const data = await readJson(file());
  if (!Array.isArray(data)) return [];
  return data.slice(0, MAX_BACKGROUNDS).flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string')
      return [];
    const background = parseCustomBackground(entry.background);
    return background ? [{ id: entry.id, name: entry.name.slice(0, 60), background }] : [];
  });
}

export function registerBackgrounds(): void {
  handle('backgrounds:list', () => serial(readBackgrounds));
  handle('backgrounds:save', (input) =>
    serial(async () => {
      const background = parseCustomBackground(input?.background);
      const name = typeof input?.name === 'string' ? input.name.trim().slice(0, 60) : '';
      if (!background || !name) throw new Error('Enter a name and choose a background.');
      const entries = await readBackgrounds();
      const index = entries.findIndex(({ id }) => id === input.id);
      if (input.id !== undefined && index === -1) throw new Error('This background was removed.');
      if (index === -1 && entries.length >= MAX_BACKGROUNDS) {
        throw new Error(
          `Remove a saved background to add another. You can save up to ${MAX_BACKGROUNDS}.`,
        );
      }
      const entry = { id: entries[index]?.id ?? randomUUID(), name, background };
      if (index === -1) entries.unshift(entry);
      else entries[index] = entry;
      await writeFileAtomic(file(), JSON.stringify(entries));
      broadcast('backgrounds:changed', undefined);
      return entry;
    }),
  );
  handle('backgrounds:remove', (id) =>
    serial(async () => {
      const entries = await readBackgrounds();
      const remaining = entries.filter((entry) => entry.id !== id);
      if (remaining.length !== entries.length) {
        await writeFileAtomic(file(), JSON.stringify(remaining));
        broadcast('backgrounds:changed', undefined);
      }
    }),
  );
}
