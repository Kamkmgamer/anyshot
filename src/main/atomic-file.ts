import { randomBytes } from 'node:crypto';
import { type FileHandle, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Writes a file atomically: the data goes to a temporary sibling which is
 * flushed and then renamed over the target, so readers see either the old or
 * the new content, never a torn write.
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  const handle = await open(temp, 'wx');
  try {
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(temp, path);
  } catch (error) {
    // Keep the original error even if the partial temp file can't be removed.
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Creates `base.ext`, or `base (2).ext`, `base (3).ext`… if that is taken. The
 * file is created exclusively, so concurrent saves can never pick the same name.
 */
export async function createUniqueFile(
  base: string,
  ext: string,
): Promise<{ path: string; handle: FileHandle }> {
  await mkdir(dirname(base), { recursive: true });
  for (let i = 1; ; i++) {
    const path = i === 1 ? `${base}.${ext}` : `${base} (${i}).${ext}`;
    try {
      return { path, handle: await open(path, 'wx') };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

// Windows can briefly lock a file (indexers, antivirus); retry a few times.
async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (i >= attempts - 1 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * (i + 1)));
    }
  }
}

/**
 * Reads a JSON file; `undefined` means it does not exist. Read and parse errors
 * are thrown, so a caller never mistakes an unreadable file for a missing one
 * and overwrites it.
 */
export async function readJson(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  return JSON.parse(text);
}
