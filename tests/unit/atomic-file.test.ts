import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUniqueFile, readJson, writeFileAtomic } from '../../src/main/atomic-file';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'anyshot-atomic-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('atomic file writes', () => {
  it('replaces content and leaves no temp files behind', async () => {
    const file = join(dir, 'nested', 'settings.json');
    await writeFileAtomic(file, '{"a":1}');
    await writeFileAtomic(file, '{"a":2}');
    expect(await readFile(file, 'utf8')).toBe('{"a":2}');
    expect(await readdir(join(dir, 'nested'))).toEqual(['settings.json']);
  });

  it('survives concurrent writers with one complete result', async () => {
    const file = join(dir, 'race.json');
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => writeFileAtomic(file, JSON.stringify({ i }))),
    );
    const value = (await readJson(file)) as { i: number };
    expect(value.i).toBeGreaterThanOrEqual(0);
    expect(await readdir(dir)).toEqual(['race.json']);
  });

  it('reads a missing file as undefined but reports corrupt or unreadable ones', async () => {
    expect(await readJson(join(dir, 'missing.json'))).toBeUndefined();
    await writeFileAtomic(join(dir, 'bad.json'), '{oops');
    await expect(readJson(join(dir, 'bad.json'))).rejects.toThrow(SyntaxError);
    await expect(readJson(dir)).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('removes the temp file when the write fails', async () => {
    const file = join(dir, 'fails.json');
    // Not writable data: the write fails after the temp file was created.
    const bad = 42 as unknown as string;
    await expect(writeFileAtomic(file, bad)).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('unique files', () => {
  it('gives concurrent callers distinct new files and keeps existing ones', async () => {
    const base = join(dir, 'shots', 'capture');
    await writeFileAtomic(`${base}.png`, 'existing');
    const created = await Promise.all(
      Array.from({ length: 5 }, () => createUniqueFile(base, 'png')),
    );
    await Promise.all(created.map(({ handle }) => handle.close()));
    expect(created.map((c) => c.path).sort()).toEqual(
      [2, 3, 4, 5, 6].map((i) => `${base} (${i}).png`),
    );
    expect(await readFile(`${base}.png`, 'utf8')).toBe('existing');
  });
});
