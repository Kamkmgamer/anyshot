import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HistoryEntry } from '../shared/ipc';
import { readJson, writeFileAtomic } from './atomic-file';
import { paths } from './paths';
import { registerMediaRoute } from './protocol';
import { serialQueue } from './serial';
import { getSettings } from './settings-store';
import { send, windowsOf } from './windows';

/**
 * Capture history: one PNG and one WebP thumbnail per entry plus a JSON index,
 * all under userData/history. Thumbnails are written at capture time so the
 * history window never decodes full images.
 */
let entries: HistoryEntry[] | null = null;
let loading: Promise<HistoryEntry[]> | null = null;
/** Serialises index updates so concurrent captures can't lose entries. */
const serial = serialQueue();
/** How many consumers (pins, previews, editors, a delivery) hold each entry. */
const holds = new Map<string, number>();

const indexFile = () => join(paths.historyDir, 'index.json');
export const imagePath = (id: string) => join(paths.historyDir, `${id}.png`);
export const thumbPath = (id: string) => join(paths.historyDir, `${id}.thumb.webp`);

function isEntry(v: unknown): v is HistoryEntry {
  const e = v as HistoryEntry;
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof e.id === 'string' &&
    /^[\w-]+$/.test(e.id) &&
    typeof e.createdAt === 'number' &&
    typeof e.width === 'number' &&
    typeof e.height === 'number'
  );
}

async function load(): Promise<HistoryEntry[]> {
  if (entries) return entries;
  loading ??= readJson(indexFile())
    .then((raw) => {
      if (raw !== undefined && !Array.isArray(raw)) throw new Error('Invalid history index');
      entries = raw?.filter(isEntry) ?? [];
      return entries;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

async function persist(next: HistoryEntry[]): Promise<void> {
  await writeFileAtomic(indexFile(), JSON.stringify(next, null, 1));
  entries = next;
  // Open history windows reload, so captures finished after they opened still appear.
  for (const win of windowsOf('history')) send(win, 'history:changed', undefined);
}

/**
 * Entries used by open pins, previews or editors survive pruning until every
 * holder has released them. Each retain must be balanced by one release.
 */
export function retain(id: string): void {
  holds.set(id, (holds.get(id) ?? 0) + 1);
}

export function release(id: string): void {
  const count = (holds.get(id) ?? 0) - 1;
  if (count > 0) holds.set(id, count);
  else holds.delete(id);
  void serial(prune).catch((error) => console.error('[history] pruning failed', error));
}

function removeFiles(list: readonly HistoryEntry[]): Promise<unknown> {
  return Promise.all(
    list.flatMap((e) => [
      rm(imagePath(e.id), { force: true }),
      rm(thumbPath(e.id), { force: true }),
    ]),
  );
}

async function prune(): Promise<void> {
  const list = await load();
  const limit = getSettings().output.historySize;
  const keep: HistoryEntry[] = [];
  const drop: HistoryEntry[] = [];
  for (const [i, entry] of list.entries()) {
    (i < limit || holds.has(entry.id) ? keep : drop).push(entry);
  }
  if (drop.length === 0) return;
  await persist(keep);
  await removeFiles(drop);
}

export function addEntry(input: {
  png: Uint8Array;
  thumb?: ArrayBuffer;
  width: number;
  height: number;
  savedPath?: string | null;
}): Promise<HistoryEntry> {
  return serial(async () => {
    const list = await load();
    await mkdir(paths.historyDir, { recursive: true });
    const entry: HistoryEntry = {
      id: randomUUID(),
      createdAt: Date.now(),
      width: input.width,
      height: input.height,
      kind: 'image',
      savedPath: input.savedPath ?? null,
    };
    try {
      await writeFile(imagePath(entry.id), input.png);
      if (input.thumb) await writeFile(thumbPath(entry.id), new Uint8Array(input.thumb));
      await persist([entry, ...list]);
    } catch (error) {
      await removeFiles([entry]).catch(() => undefined);
      throw error;
    }
    retain(entry.id);
    return entry;
  });
}

export async function listEntries(): Promise<HistoryEntry[]> {
  const limit = getSettings().output.historySize;
  return (await load()).filter((e, i) => i < limit || holds.has(e.id));
}

export async function getEntry(id: string): Promise<HistoryEntry | undefined> {
  return (await load()).find((e) => e.id === id);
}

export function getRetainedEntry(id: string): Promise<HistoryEntry | undefined> {
  return serial(async () => {
    const entry = await getEntry(id);
    if (entry) retain(id);
    return entry;
  });
}

export function updateEntry(id: string, patch: Partial<Omit<HistoryEntry, 'id'>>): Promise<void> {
  return serial(async () => {
    const list = await load();
    await persist(list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  });
}

export async function readImage(id: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(imagePath(id)));
}

export function removeEntry(id: string): Promise<void> {
  return serial(async () => {
    const list = await load();
    await persist(list.filter((e) => e.id !== id));
    await removeFiles(list.filter((e) => e.id === id));
  });
}

export function clearHistory(): Promise<void> {
  return serial(async () => {
    const list = await load();
    // Decide once: a hold released during the write must not delete a kept entry.
    const keep = list.filter((e) => holds.has(e.id));
    const drop = list.filter((e) => !holds.has(e.id));
    await persist(keep);
    await removeFiles(drop);
  });
}

registerMediaRoute('history', async (rest) => {
  const [id, what] = rest.split('/');
  if (!id || !/^[\w-]+$/.test(id)) return null;
  try {
    if (what === 'thumb') {
      // Entries added without a thumbnail (e.g. pinned from the clipboard) fall back to the image.
      const thumb = await readFile(thumbPath(id)).catch(() => null);
      if (thumb) return new Response(thumb, { headers: { 'content-type': 'image/webp' } });
      return new Response(await readFile(imagePath(id)), {
        headers: { 'content-type': 'image/png' },
      });
    }
    if (what === 'image') {
      return new Response(await readFile(imagePath(id)), {
        headers: { 'content-type': 'image/png' },
      });
    }
  } catch {
    return null;
  }
  return null;
});

/**
 * Replaces an entry's image (edits saved back from the editor). `savedPath` is
 * updated when the edit was also saved to a file.
 */
export function replaceImage(
  id: string,
  input: {
    png: Uint8Array;
    thumb?: ArrayBuffer;
    width: number;
    height: number;
    savedPath?: string;
  },
): Promise<HistoryEntry | undefined> {
  return serial(async () => {
    const list = await load();
    const entry = list.find((e) => e.id === id);
    if (!entry) return undefined;
    // Atomic: a failed write must not leave the entry pointing at a torn image.
    await writeFileAtomic(imagePath(id), input.png);
    if (input.thumb) await writeFileAtomic(thumbPath(id), new Uint8Array(input.thumb));
    const updated = {
      ...entry,
      width: input.width,
      height: input.height,
      ...(input.savedPath ? { savedPath: input.savedPath } : {}),
    };
    await persist(list.map((e) => (e.id === id ? updated : e)));
    return updated;
  });
}
