import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HistoryEntry } from '../shared/ipc';
import { readJson, writeFileAtomic } from './atomic-file';
import { paths } from './paths';
import { registerMediaRoute } from './protocol';
import { getSettings } from './settings-store';

/**
 * Capture history: one PNG and one WebP thumbnail per entry plus a JSON index,
 * all under userData/history. Thumbnails are written at capture time so the
 * history window never decodes full images.
 */
let entries: HistoryEntry[] | null = null;
let chain: Promise<unknown> = Promise.resolve();
const pinned = new Set<string>();

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
  const raw = await readJson(indexFile());
  entries = Array.isArray(raw) ? raw.filter(isEntry) : [];
  return entries;
}

/** Serialises index updates so concurrent captures can't lose entries. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

async function persist(): Promise<void> {
  await writeFileAtomic(indexFile(), JSON.stringify(entries ?? [], null, 1));
}

/** Entries used by open pins or thumbnails survive pruning until released. */
export function retain(id: string): void {
  pinned.add(id);
}

export function release(id: string): void {
  pinned.delete(id);
  void serial(prune);
}

async function prune(): Promise<void> {
  const list = await load();
  const limit = getSettings().output.historySize;
  const keep: HistoryEntry[] = [];
  const drop: HistoryEntry[] = [];
  for (const [i, entry] of list.entries()) {
    (i < limit || pinned.has(entry.id) ? keep : drop).push(entry);
  }
  if (drop.length === 0) return;
  entries = keep;
  await persist();
  await Promise.all(
    drop.flatMap((e) => [
      rm(imagePath(e.id), { force: true }),
      rm(thumbPath(e.id), { force: true }),
    ]),
  );
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
    await writeFile(imagePath(entry.id), input.png);
    if (input.thumb) await writeFile(thumbPath(entry.id), new Uint8Array(input.thumb));
    // Fresh entries are retained until a consumer (thumbnail, pin) releases them,
    // so a history size of 0 still lets the floating preview show the capture.
    retain(entry.id);
    entries = [entry, ...list];
    await persist();
    return entry;
  });
}

export async function listEntries(): Promise<HistoryEntry[]> {
  const limit = getSettings().output.historySize;
  return (await load()).filter((e, i) => i < limit || pinned.has(e.id)).slice();
}

export async function getEntry(id: string): Promise<HistoryEntry | undefined> {
  return (await load()).find((e) => e.id === id);
}

export function updateEntry(id: string, patch: Partial<Omit<HistoryEntry, 'id'>>): Promise<void> {
  return serial(async () => {
    entries = (await load()).map((e) => (e.id === id ? { ...e, ...patch } : e));
    await persist();
  });
}

export async function readImage(id: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(imagePath(id)));
}

export function removeEntry(id: string): Promise<void> {
  return serial(async () => {
    entries = (await load()).filter((e) => e.id !== id);
    pinned.delete(id);
    await persist();
    await rm(imagePath(id), { force: true });
    await rm(thumbPath(id), { force: true });
  });
}

export function clearHistory(): Promise<void> {
  return serial(async () => {
    const list = await load();
    const keep = list.filter((e) => pinned.has(e.id));
    entries = keep;
    await persist();
    await Promise.all(
      list
        .filter((e) => !pinned.has(e.id))
        .flatMap((e) => [
          rm(imagePath(e.id), { force: true }),
          rm(thumbPath(e.id), { force: true }),
        ]),
    );
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

/** Replaces an entry's image (edits saved back from the editor). */
export function replaceImage(
  id: string,
  input: { png: Uint8Array; thumb?: ArrayBuffer; width: number; height: number },
): Promise<HistoryEntry | undefined> {
  return serial(async () => {
    const list = await load();
    const entry = list.find((e) => e.id === id);
    if (!entry) return undefined;
    await writeFile(imagePath(id), input.png);
    if (input.thumb) await writeFile(thumbPath(id), new Uint8Array(input.thumb));
    const updated = { ...entry, width: input.width, height: input.height };
    entries = list.map((e) => (e.id === id ? updated : e));
    await persist();
    return updated;
  });
}
