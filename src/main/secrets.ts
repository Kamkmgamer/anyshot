import { readFile } from 'node:fs/promises';
import { safeStorage } from 'electron';
import { isRecord } from '../shared/schema';
import { writeFileAtomic } from './atomic-file';
import { handle } from './ipc';
import { paths } from './paths';
import { serialQueue } from './serial';
import { getSettings, onSettingsChanged } from './settings-store';

/**
 * Upload credentials, encrypted with the OS keychain through safeStorage and
 * kept in their own file: never in settings.json, never sent to windows.
 */
export const SECRET_KEYS = ['httpAuthorization', 's3AccessKeyId', 's3SecretAccessKey'] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

const serial = serialQueue();

export function secretsBackend(): string {
  return process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os';
}

function encryptionReady(): boolean {
  if (secretsBackend() === 'basic_text') {
    const allowed = getSettings().uploads.allowWeakSecretStorage;
    safeStorage.setUsePlainTextEncryption(allowed);
    if (!allowed) return false;
  }
  return safeStorage.isEncryptionAvailable();
}

onSettingsChanged((next, prev) => {
  if (next.uploads.allowWeakSecretStorage !== prev.uploads.allowWeakSecretStorage) {
    encryptionReady();
  }
});

async function load(): Promise<Partial<Record<SecretKey, string>>> {
  if (!encryptionReady()) return {};
  let encrypted: Buffer;
  try {
    encrypted = await readFile(paths.secretsFile);
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return {};
    throw error;
  }
  if (!encryptionReady()) return {};
  const raw: unknown = JSON.parse(safeStorage.decryptString(encrypted));
  if (!isRecord(raw)) throw new Error('Invalid credential store');
  const secrets: Partial<Record<SecretKey, string>> = {};
  for (const key of SECRET_KEYS) {
    if (typeof raw[key] === 'string') secrets[key] = raw[key];
  }
  return secrets;
}

export async function getSecret(key: SecretKey): Promise<string | undefined> {
  return (await load())[key] || undefined;
}

function requireEncryption(): void {
  if (!encryptionReady()) {
    throw new Error('No system keychain is available, so anyshot will not store credentials.');
  }
}

export function setSecret(key: SecretKey, value: string): Promise<void> {
  return serial(async () => {
    requireEncryption();
    const all = await load();
    requireEncryption();
    if (value) all[key] = value;
    else delete all[key];
    await writeFileAtomic(paths.secretsFile, safeStorage.encryptString(JSON.stringify(all)));
  });
}

handle('secrets:status', async () => {
  const backend = secretsBackend();
  const keys = Object.keys(await load());
  return {
    available: encryptionReady(),
    backend,
    keys,
    weakOptIn: backend === 'basic_text',
  };
});

handle('secrets:set', ({ key, value }) => {
  const known = SECRET_KEYS.find((candidate) => candidate === key);
  if (!known) throw new Error('Unknown secret');
  return setSecret(known, value);
});
