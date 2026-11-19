import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { dispatch, type Launched, launch, pageOf, windowKinds } from './harness';

let ctx: Launched;

test.beforeEach(async () => {
  ctx = await launch([], {});
});

test.afterEach(async () => {
  expect(ctx.errors).toEqual([]);
  await ctx.close();
});

test('settings persist atomically, shortcuts re-register, secrets stay out of settings', async () => {
  await dispatch(ctx.app, 'settings');
  const page = await pageOf(ctx.app, 'settings');
  await expect(page.getByRole('checkbox', { name: 'Launch at login' })).toBeVisible();
  await page.getByTestId('tab-capture').click();
  await page.getByTestId('instant-capture').check();
  const file = join(ctx.userData, 'settings.json');
  await expect
    .poll(async () => JSON.parse(await readFile(file, 'utf8')).capture.instantCapture)
    .toBe(true);

  await page.getByTestId('tab-shortcuts').click();
  await page.getByTestId('hotkey-captureArea').click();
  await page.keyboard.press('Alt+Shift+Q');
  await expect(page.getByTestId('hotkey-captureArea')).toHaveText('Alt+Shift+Q');
  await expect
    .poll(() =>
      ctx.app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Alt+Shift+Q')),
    )
    .toBe(true);
  expect(
    await ctx.app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Alt+Shift+X')),
  ).toBe(false);

  await page.getByTestId('tab-uploads').click();
  await page.getByRole('combobox', { name: 'Provider' }).selectOption('http');
  // Xvfb has no keyring: anyshot refuses to store secrets until the user opts in.
  await expect(page.getByText(/only be obfuscated/)).toBeVisible();
  await page.getByTestId('weak-secrets').check();
  const secret = page.locator('input[type="password"]');
  await secret.fill('Bearer super-secret-token');
  await secret.press('Tab');
  await expect(secret).toHaveAttribute('placeholder', /stored/);
  const settingsText = await readFile(file, 'utf8');
  expect(settingsText).not.toContain('super-secret-token');
  const secrets = await readFile(join(ctx.userData, 'secrets.bin'));
  expect(secrets.includes(Buffer.from('super-secret-token'))).toBe(false);

  // A second request focuses the existing window instead of opening another.
  await dispatch(ctx.app, 'settings');
  expect((await windowKinds(ctx.app)).filter((k) => k === 'settings')).toHaveLength(1);
});

test('rapid tool toggles each reach the saved settings', async () => {
  await dispatch(ctx.app, 'settings');
  const page = await pageOf(ctx.app, 'settings');
  await page.getByTestId('tab-tools').click();
  const checkboxes = page.getByRole('checkbox', { name: /^(Arrow|Rectangle)$/ });
  await expect(checkboxes).toHaveCount(2);
  await checkboxes.evaluateAll((elements) => {
    for (const element of elements) if (element instanceof HTMLInputElement) element.click();
  });
  const file = join(ctx.userData, 'settings.json');
  await expect
    .poll(async () => {
      const enabled = JSON.parse(await readFile(file, 'utf8')).tools.enabledTools;
      return { arrow: enabled.includes('arrow'), rect: enabled.includes('rect') };
    })
    .toEqual({ arrow: false, rect: false });
});
