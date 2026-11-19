import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readJson, writeFileAtomic } from '../../src/main/atomic-file';

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

  it('reads missing or corrupt JSON as undefined', async () => {
    expect(await readJson(join(dir, 'missing.json'))).toBeUndefined();
    await writeFileAtomic(join(dir, 'bad.json'), '{oops');
    expect(await readJson(join(dir, 'bad.json'))).toBeUndefined();
  });
});
