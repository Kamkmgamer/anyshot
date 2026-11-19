import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron, type ElectronApplication, expect, type Page } from '@playwright/test';
import type { WindowKind } from '../../src/shared/ipc';

export interface Launched {
  app: ElectronApplication;
  userData: string;
  errors: string[];
  close(): Promise<void>;
}

/**
 * Launches the built app with an isolated profile. ANYSHOT_TEST exposes
 * `globalThis.__anyshot` in main, which tests drive through `app.evaluate`.
 */
export async function launch(args: string[] = [], settings?: unknown): Promise<Launched> {
  const userData = await mkdtemp(join(tmpdir(), 'anyshot-e2e-'));
  if (settings) await writeFile(join(userData, 'settings.json'), JSON.stringify(settings));
  const errors: string[] = [];
  const app = await _electron.launch({
    args: ['.', ...args],
    env: {
      ...process.env,
      ANYSHOT_TEST: '1',
      ANYSHOT_USER_DATA: userData,
      XDG_CONFIG_HOME: join(userData, 'config'),
    },
  });
  const watch = (page: Page) => {
    page.on('pageerror', (error) => errors.push(`${page.url()}: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${page.url()}: ${message.text()}`);
    });
  };
  app.context().on('page', watch);
  await expect
    .poll(() => app.evaluate(() => globalThis.__anyshot !== undefined), { timeout: 15_000 })
    .toBe(true);
  return {
    app,
    userData,
    errors,
    async close() {
      await app.close().catch(() => {});
      await rm(userData, { recursive: true, force: true });
    },
  };
}

export function processTypes(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => globalThis.__anyshot?.processTypes() ?? []);
}

export function windowKinds(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => globalThis.__anyshot?.windows().map((w) => w.kind) ?? []);
}

export async function dispatch(app: ElectronApplication, action: string, file?: string) {
  await app.evaluate(
    (_electron, [action, file]) => globalThis.__anyshot?.dispatch(action as never, file),
    [action, file] as const,
  );
}

/** Waits for a window of the given kind and returns its page. */
export async function pageOf(app: ElectronApplication, kind: WindowKind): Promise<Page> {
  const match = () => app.windows().find((p) => p.url().includes(`app://local/${kind}/`));
  await expect.poll(() => match() !== undefined, { timeout: 15_000 }).toBe(true);
  const page = match();
  if (!page) throw new Error(`no ${kind} window`);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

export function rendererCount(types: string[]): number {
  return types.filter((t) => t === 'Tab').length;
}
