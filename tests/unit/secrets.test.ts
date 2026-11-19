import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  path: '',
  backend: 'basic_text',
  plaintextEnabled: false,
  optIn: true,
}));
vi.mock('electron', () => ({
  safeStorage: {
    getSelectedStorageBackend: () => state.backend,
    isEncryptionAvailable: () => state.plaintextEnabled,
    setUsePlainTextEncryption: (enabled: boolean) => {
      state.plaintextEnabled = enabled;
    },
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));
vi.mock('../../src/main/paths', () => ({
  paths: {
    get secretsFile() {
      return state.path;
    },
  },
}));
vi.mock('../../src/main/ipc', () => ({ handle: () => {} }));
vi.mock('../../src/main/settings-store', () => ({
  getSettings: () => ({ uploads: { allowWeakSecretStorage: state.optIn } }),
  onSettingsChanged: () => {},
}));

let dir: string;
let secrets: typeof import('../../src/main/secrets');
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'anyshot-credentials-'));
  state.path = join(dir, 'secrets.bin');
  state.plaintextEnabled = false;
  state.optIn = true;
  vi.resetModules();
  secrets = await import('../../src/main/secrets');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it.runIf(process.platform === 'linux')('preserves concurrent credential changes', async () => {
  await Promise.all([
    secrets.setSecret('s3AccessKeyId', 'id'),
    secrets.setSecret('s3SecretAccessKey', 'key'),
  ]);
  expect(await secrets.getSecret('s3AccessKeyId')).toBe('id');
  expect(await secrets.getSecret('s3SecretAccessKey')).toBe('key');
});

it.runIf(process.platform === 'linux')(
  'disables reads and writes after weak storage is turned off',
  async () => {
    await secrets.setSecret('httpAuthorization', 'token');
    expect(state.plaintextEnabled).toBe(true);
    const saved = await readFile(state.path);
    state.optIn = false;
    expect(await secrets.getSecret('httpAuthorization')).toBeUndefined();
    expect(state.plaintextEnabled).toBe(false);
    await expect(secrets.setSecret('httpAuthorization', 'new-token')).rejects.toThrow('keychain');
    expect(await readFile(state.path)).toEqual(saved);
  },
);
