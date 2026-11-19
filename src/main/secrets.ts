import { readFile } from 'node:fs/promises';
import { safeStorage } from 'electron';
import { writeFileAtomic } from './atomic-file';
import { handle } from './ipc';
import { paths } from './paths';

/**
 * Upload credentials, encrypted with the OS keychain through safeStorage and
 * kept in their own file: never in settings.json, never sent to windows.
 */
export const SECRET_KEYS = ['httpAuthorization', 's3AccessKeyId', 's3SecretAccessKey'] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

async function load(): Promise<Partial<Record<SecretKey, string>>> {
  try {
    const encrypted = await readFile(paths.secretsFile);
    return JSON.parse(safeStorage.decryptString(encrypted));
  } catch {
    return {};
  }
}

export async function getSecret(key: SecretKey): Promise<string | undefined> {
  return (await load())[key] || undefined;
}

export function secretsBackend(): string {
  return process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os';
}

export async function setSecret(key: SecretKey, value: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('No system keychain is available, so anyshot will not store credentials.');
  }
  const all = await load();
  if (value) all[key] = value;
  else delete all[key];
  await writeFileAtomic(paths.secretsFile, safeStorage.encryptString(JSON.stringify(all)));
}

handle('secrets:status', async () => ({
  available: safeStorage.isEncryptionAvailable(),
  // On Linux without a keyring this is "basic_text": obfuscated, not truly encrypted.
  backend: secretsBackend(),
  keys: Object.keys(await load()),
}));

handle('secrets:set', ({ key, value }) => {
  if (!(SECRET_KEYS as readonly string[]).includes(key)) throw new Error('Unknown secret');
  return setSecret(key as SecretKey, value);
});
