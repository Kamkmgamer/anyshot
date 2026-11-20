import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ElectronApplication, expect, test } from '@playwright/test';
import type { UpdateOffer } from '../../src/shared/update';
import {
  clickClosing,
  dispatch,
  type Launched,
  launch,
  pageOf,
  verifyAndClose,
  windowKinds,
} from './harness';

let ctx: Launched;

test.beforeEach(async () => {
  ctx = await launch();
  // Links open in the browser; record them instead.
  await ctx.app.evaluate(({ shell }) => {
    const opened: string[] = [];
    Object.assign(globalThis, { __opened: opened });
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
});

test.afterEach(async () => {
  await verifyAndClose(ctx);
});

const offer = (patch: Partial<UpdateOffer> = {}): UpdateOffer => ({
  version: '0.3.0',
  current: '0.1.2',
  notes: ['Scroll capture keeps track while scrolling slowly', 'Text styles'],
  releaseUrl: 'https://github.com/mgamergo/anyshot/releases/tag/v0.3.0',
  canInstall: true,
  ...patch,
});

async function showOffer(app: ElectronApplication, o: UpdateOffer, plan: { fail?: string } = {}) {
  await app.evaluate((_e, [o, plan]) => globalThis.__anyshot?.offerUpdate(o, plan), [
    o,
    plan,
  ] as const);
  return pageOf(app, 'update');
}

const opened = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { __opened?: string[] }).__opened ?? []);

test('the app does not check for updates when it runs unpackaged (development, e2e)', async () => {
  expect(await ctx.app.evaluate(() => globalThis.__anyshot?.startupCheck())).toBe(0);
  expect(await windowKinds(ctx.app)).toEqual([]);
});

test('electron-updater loads in the built main process', async () => {
  // Development and the e2e suite never check, so load it explicitly: packaged builds do.
  expect(await ctx.app.evaluate(() => globalThis.__anyshot?.loadUpdater())).toBe(true);
});

test('the update window shows the version and notes, and Update downloads and installs', async () => {
  const page = await showOffer(ctx.app, offer());
  await expect(page.getByTestId('update-title')).toHaveText('anyshot 0.3.0 is available');
  await expect(page.getByText('You have 0.1.2.')).toBeVisible();
  await expect(page.getByTestId('update-notes').getByRole('listitem')).toHaveText([
    'Scroll capture keeps track while scrolling slowly',
    'Text styles',
  ]);
  await page.getByRole('button', { name: 'Release notes' }).click();
  await expect.poll(() => opened(ctx.app)).toEqual([offer().releaseUrl]);

  await page.getByTestId('update-install').click();
  await expect(page.getByTestId('update-progress')).toContainText('Downloading… 30 %');
  await expect(page.getByTestId('update-later')).toBeDisabled();
  await expect(page.getByTestId('update-progress')).toContainText('restarts in a moment');
  await expect.poll(() => ctx.app.evaluate(() => globalThis.__anyshot?.updateInstalls)).toBe(1);
});

test('a failed download says why and can be tried again; Later closes the window', async () => {
  const page = await showOffer(ctx.app, offer(), { fail: 'net::ERR_CONNECTION_RESET' });
  await page.getByTestId('update-install').click();
  await expect(page.getByTestId('update-error')).toContainText('net::ERR_CONNECTION_RESET');
  await expect(page.getByTestId('update-install')).toHaveText('Try again');
  await expect(page.getByTestId('update-later')).toBeEnabled();
  expect(await ctx.app.evaluate(() => globalThis.__anyshot?.updateInstalls)).toBe(0);
  await clickClosing(page.getByTestId('update-later'));
  await expect.poll(() => windowKinds(ctx.app)).toEqual([]);
});

test('a .deb install links to the release instead of updating itself', async () => {
  const page = await showOffer(ctx.app, offer({ canInstall: false }));
  await expect(page.getByTestId('update-manual')).toContainText('.deb');
  await expect(page.getByTestId('update-install')).toHaveCount(0);
  await clickClosing(page.getByTestId('update-download'));
  await expect.poll(() => windowKinds(ctx.app)).toEqual([]);
  expect(await opened(ctx.app)).toEqual([offer().releaseUrl]);
});

test('update checks can be turned off in Settings', async () => {
  await dispatch(ctx.app, 'settings');
  const page = await pageOf(ctx.app, 'settings');
  const toggle = page.getByTestId('check-updates');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect
    .poll(async () => {
      const saved = JSON.parse(await readFile(join(ctx.userData, 'settings.json'), 'utf8'));
      return saved.general?.checkForUpdates;
    })
    .toBe(false);
});
