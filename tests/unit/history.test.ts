import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// history.ts talks to Electron through these modules; the tests replace them
// and add two hooks to reproduce races deterministically: a delay or failure
// for index reads, and a callback that runs right after each index write.
const state = vi.hoisted(() => ({
  dir: '',
  historySize: 10,
  indexReads: [] as (() => Promise<void>)[],
  afterPersist: undefined as (() => void) | undefined,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    readFile: async (...args: Parameters<typeof real.readFile>) => {
      if (String(args[0]).endsWith('index.json')) await state.indexReads.shift()?.();
      return real.readFile(...args);
    },
  };
});
vi.mock('../../src/main/paths', () => ({
  paths: {
    get historyDir() {
      return state.dir;
    },
  },
}));
vi.mock('../../src/main/protocol', () => ({ registerMediaRoute: () => {} }));
vi.mock('../../src/main/windows', () => ({
  send: () => {},
  windowsOf: () => {
    state.afterPersist?.();
    return [];
  },
}));
vi.mock('../../src/main/settings-store', () => ({
  getSettings: () => ({ output: { historySize: state.historySize } }),
}));

type History = typeof import('../../src/main/history');
let history: History;

const png = new Uint8Array([137, 80, 78, 71]);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const indexFile = () => join(state.dir, 'index.json');
const indexIds = async () =>
  (JSON.parse(await fs.readFile(indexFile(), 'utf8')) as { id: string }[]).map((e) => e.id);
/** Waits for queued history work (e.g. the prune a release schedules). */
const settle = () => history.updateEntry('none', {});

beforeEach(async () => {
  state.dir = await fs.mkdtemp(join(tmpdir(), 'anyshot-history-'));
  state.historySize = 10;
  state.indexReads = [];
  state.afterPersist = undefined;
  vi.resetModules();
  history = await import('../../src/main/history');
});

afterEach(async () => {
  await fs.rm(state.dir, { recursive: true, force: true });
});

async function seed(ids: string[]): Promise<void> {
  const entries = ids.map((id) => ({ id, createdAt: 1, width: 1, height: 1, kind: 'image' }));
  await fs.writeFile(indexFile(), JSON.stringify(entries));
  for (const id of ids) await fs.writeFile(history.imagePath(id), png);
}

describe('history', () => {
  it('shares the first index read, so a slow read cannot drop a new capture', async () => {
    await seed(['old']);
    state.indexReads = [() => sleep(50), async () => {}];
    const [listed, added] = await Promise.all([
      history.listEntries(),
      history.addEntry({ png, width: 1, height: 1 }),
    ]);
    expect(listed.map((e) => e.id)).toContain('old');
    await settle();
    expect(await indexIds()).toEqual([added.id, 'old']);
  });

  it('does not overwrite the index after a failed read', async () => {
    await seed(['old']);
    state.indexReads = [
      async () => {
        throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
      },
    ];
    await expect(history.addEntry({ png, width: 1, height: 1 })).rejects.toThrow('EIO');
    expect(await indexIds()).toEqual(['old']);
    const added = await history.addEntry({ png, width: 1, height: 1 });
    expect(await indexIds()).toEqual([added.id, 'old']);
  });

  it('preserves an index that is not valid JSON', async () => {
    await fs.writeFile(indexFile(), '{oops');
    await expect(history.addEntry({ png, width: 1, height: 1 })).rejects.toThrow(SyntaxError);
    expect(await fs.readFile(indexFile(), 'utf8')).toBe('{oops');
  });

  it('keeps an entry until every holder has released it', async () => {
    state.historySize = 0;
    const entry = await history.addEntry({ png, width: 1, height: 1 }); // the delivery's hold
    history.retain(entry.id); // a preview's hold
    history.release(entry.id); // delivery done
    await settle();
    expect(existsSync(history.imagePath(entry.id))).toBe(true);
    expect(await indexIds()).toEqual([entry.id]);
    history.release(entry.id); // preview closed
    await settle();
    expect(existsSync(history.imagePath(entry.id))).toBe(false);
    expect(await indexIds()).toEqual([]);
  });

  it('clearing deletes exactly the entries it removed from the index', async () => {
    await seed(['held', 'free']);
    history.retain('held');
    // The hold goes while the cleared index is being written.
    state.afterPersist = () => {
      state.afterPersist = undefined;
      history.release('held');
    };
    await history.clearHistory();
    expect(await indexIds()).toEqual(['held']);
    expect(existsSync(history.imagePath('held'))).toBe(true);
    expect(existsSync(history.imagePath('free'))).toBe(false);
  });

  it('replaces an image and records where the edit was saved', async () => {
    await seed(['a']);
    const updated = await history.replaceImage('a', {
      png: new Uint8Array([1, 2, 3]),
      width: 2,
      height: 3,
      savedPath: '/tmp/a.png',
    });
    expect(updated).toMatchObject({ id: 'a', width: 2, height: 3, savedPath: '/tmp/a.png' });
    expect([...(await fs.readFile(history.imagePath('a')))]).toEqual([1, 2, 3]);
    expect((await fs.readdir(state.dir)).sort()).toEqual(['a.png', 'index.json']);
  });
});
