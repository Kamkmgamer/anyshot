import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { TOOL_IDS } from '../../src/shared/settings';
import { dispatch, type Launched, launch, pageOf, verifyAndClose, windowKinds } from './harness';

let ctx: Launched;
const linux = process.platform === 'linux';

test.beforeEach(async () => {
  ctx = await launch(linux ? ['--password-store=basic'] : [], {});
});

test.afterEach(async () => {
  await verifyAndClose(ctx);
});

test('settings persist atomically, shortcuts re-register, secrets stay out of settings', async () => {
  await dispatch(ctx.app, 'settings');
  const page = await pageOf(ctx.app, 'settings');
  await expect(page.getByRole('checkbox', { name: 'Launch at login' })).toBeVisible();
  const accessibility = await page.context().newCDPSession(page);
  try {
    const { root } = await accessibility.send('DOM.getDocument');
    const { nodeId } = await accessibility.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: 'input[type="color"]',
    });
    const { nodes } = await accessibility.send('Accessibility.getPartialAXTree', { nodeId });
    expect(nodes[0]).toMatchObject({
      role: { value: 'ColorWell' },
      name: { value: 'Accent colour' },
    });
  } finally {
    await accessibility.detach();
  }
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
  const weak = page.getByTestId('weak-secrets');
  const warning = page.getByText(/only be obfuscated/);
  if (linux) {
    expect(
      await ctx.app.evaluate(({ safeStorage }) => safeStorage.getSelectedStorageBackend()),
    ).toBe('basic_text');
    await expect(warning).toBeVisible();
    await weak.check();
    await expect
      .poll(() => ctx.app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()))
      .toBe(true);
  } else {
    await expect(warning).toHaveCount(0);
    await expect(weak).toHaveCount(0);
  }
  const secret = page.locator('input[type="password"]');
  await secret.fill('Bearer super-secret-token');
  await secret.press('Tab');
  await expect(secret).toHaveAttribute('placeholder', /stored/);
  const settingsText = await readFile(file, 'utf8');
  expect(settingsText).not.toContain('super-secret-token');
  const secrets = await readFile(join(ctx.userData, 'secrets.bin'));
  expect(secrets.includes(Buffer.from('super-secret-token'))).toBe(false);

  if (linux) {
    await expect(warning).toBeVisible();
    await expect(weak).toBeChecked();
    await weak.uncheck();
    await expect(secret).not.toHaveAttribute('placeholder', /stored/);
    await expect(weak).not.toBeChecked();
    await expect(warning).toBeVisible();
    expect(await ctx.app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable())).toBe(
      false,
    );
    const status = await page.evaluate(() => window.anyshot.invoke('secrets:status'));
    expect(status).toMatchObject({
      available: false,
      backend: 'basic_text',
      keys: [],
      weakOptIn: true,
    });
  }

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
      const enabled = JSON.parse(await readFile(file, 'utf8')).tools?.enabledTools;
      return { arrow: enabled?.includes('arrow') ?? true, rect: enabled?.includes('rect') ?? true };
    })
    .toEqual({ arrow: false, rect: false });
});

test('the appearance control switches every control and open window between themes', async () => {
  await dispatch(ctx.app, 'settings');
  const page = await pageOf(ctx.app, 'settings');
  await dispatch(ctx.app, 'history');
  const history = await pageOf(ctx.app, 'history');
  const theme = page.getByRole('radiogroup', { name: 'Appearance' });
  const radio = (name: string) => theme.getByRole('radio', { name });
  await expect(radio('Dark')).toBeChecked();
  const background = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  const scheme = () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  const historyBackground = () =>
    history.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await radio('Light').click();
  await expect(radio('Light')).toBeChecked();
  await expect(radio('Dark')).not.toBeChecked();
  await expect.poll(scheme).toBe('light');
  await page.getByTestId('tab-capture').click();
  await expect.poll(() => background('select')).toBe('rgb(255, 255, 255)');
  await expect.poll(() => background('input[type="number"]')).toBe('rgb(255, 255, 255)');
  await expect.poll(historyBackground).toBe('rgb(250, 250, 250)');
  const file = join(ctx.userData, 'settings.json');
  await expect
    .poll(async () => JSON.parse(await readFile(file, 'utf8')).general.toolbarTheme)
    .toBe('light');

  // Keyboard: arrows move the choice within the group.
  await page.getByTestId('tab-general').click();
  await radio('Light').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(radio('Dark')).toBeChecked();
  await expect.poll(scheme).toBe('dark');
  await page.getByTestId('tab-output').click();
  await expect.poll(() => background('select')).toBe('rgb(15, 15, 17)');
  await expect.poll(() => background('input[type="text"]')).toBe('rgb(15, 15, 17)');
  await expect.poll(historyBackground).toBe('rgb(24, 24, 27)');
});

test('Tools > Reset to defaults asks inline, then restores and saves every tool', async () => {
  await dispatch(ctx.app, 'settings');
  const page = await pageOf(ctx.app, 'settings');
  await page.getByTestId('tab-tools').click();
  const arrow = page.getByRole('checkbox', { name: 'Arrow', exact: true });
  await arrow.uncheck();
  const file = join(ctx.userData, 'settings.json');
  // Until the first tool change is written, the file has no tools: that means all enabled.
  const enabled = async (): Promise<string[]> =>
    JSON.parse(await readFile(file, 'utf8')).tools?.enabledTools ?? [...TOOL_IDS];
  await expect.poll(enabled).not.toContain('arrow');

  // Esc backs out without changing anything.
  await page.getByTestId('reset-tools').click();
  await expect(page.getByTestId('reset-tools-cancel')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('reset-tools-confirm')).toHaveCount(0);
  await expect(arrow).not.toBeChecked();

  await page.getByTestId('reset-tools').click();
  await page.getByTestId('reset-tools-confirm').click();
  await expect(arrow).toBeChecked();
  await expect(page.getByTestId('reset-tools')).toBeVisible();
  await expect.poll(enabled).toEqual([...TOOL_IDS]);
});
