import { expect, type Page, test } from '@playwright/test';
import { showFixture } from './fixture';
import {
  dispatch,
  type Launched,
  launch,
  pageOf,
  pressClosing,
  selectCard,
  verifyAndClose,
  windowKinds,
} from './harness';
import { movePointer, releasePointer } from './pointer';

let ctx: Launched;

test.beforeEach(async () => {
  ctx = await launch([], { capture: { showThumbnail: false } });
});

test.afterEach(async () => {
  await verifyAndClose(ctx);
});

test.afterAll(() => releasePointer());

async function captureSettings(): Promise<Page> {
  await dispatch(ctx.app, 'settings');
  const settings = await pageOf(ctx.app, 'settings');
  await settings.getByTestId('tab-capture').click();
  return settings;
}

function clipboard() {
  return ctx.app.evaluate(async ({ clipboard, nativeImage }) => {
    for (const item of await clipboard.read()) {
      if (!item.types.includes('image/png')) continue;
      const blob = (await item.getType('image/png')) as Blob;
      const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
      const bgra = image.toBitmap();
      return { ...image.getSize(), corner: [bgra[2], bgra[1], bgra[0]] };
    }
    return null;
  });
}

function nearColor(
  got: readonly (number | undefined)[] | undefined,
  target: readonly number[],
  tolerance = 3,
) {
  return target.every((channel, index) => Math.abs((got?.[index] ?? -256) - channel) <= tolerance);
}

test('automatic Beautify remembers compact capture-mode controls and respects them', async () => {
  const info = test.info();
  const settings = await captureSettings();
  const toggle = settings.getByRole('checkbox', { name: /Automatic Beautify/ });
  const modes = settings.getByRole('group', { name: 'Apply to' });
  await expect(modes).toHaveCount(0);
  await toggle.check();
  await expect(modes.getByRole('checkbox', { checked: true })).toHaveCount(4);
  await modes.getByRole('checkbox', { name: 'Last area' }).uncheck();
  await toggle.uncheck();
  await expect(modes).toHaveCount(0);
  await toggle.check();
  await expect(modes.getByRole('checkbox', { name: 'Last area' })).not.toBeChecked();
  await settings.screenshot({ path: info.outputPath('automatic-beautify.png') });
  await settings.getByText('Default background', { exact: true }).click();
  const defaultBackground = settings.getByRole('button', { name: 'Background 2', exact: true });
  await defaultBackground.click();
  await expect(defaultBackground).toHaveAttribute('aria-pressed', 'true');
  await settings.close();
  await showFixture(ctx.app);
  await movePointer(150, 150);

  const area = await selectCard(ctx.app);
  const { scaleFactor } = await area.evaluate(() => window.anyshot.invoke('overlay:init'));
  const width = Math.round(300 * scaleFactor);
  const height = Math.round(200 * scaleFactor);
  const pad = Math.round(48 * scaleFactor);
  await pressClosing(area, 'Enter');
  await expect
    .poll(async () => {
      const shot = await clipboard();
      return { ...shot, expectedColor: nearColor(shot?.corner, [253, 164, 175]) };
    })
    .toMatchObject({ width: width + 2 * pad, height: height + 2 * pad, expectedColor: true });
  await expect.poll(() => windowKinds(ctx.app)).toEqual([]);

  await dispatch(ctx.app, 'captureLastArea');
  const last = await pageOf(ctx.app, 'overlay');
  await expect(last.getByTestId('actions')).toBeVisible();
  await pressClosing(last, 'Enter');
  await expect.poll(clipboard).toMatchObject({ width, height });
  await expect.poll(() => windowKinds(ctx.app)).toEqual([]);

  await ctx.app.evaluate(async () => {
    await globalThis.__anyshot?.patch({ capture: { instantPreview: false } });
  });
  await dispatch(ctx.app, 'captureScreen');
  await expect.poll(async () => nearColor((await clipboard())?.corner, [253, 164, 175])).toBe(true);
  await expect.poll(() => windowKinds(ctx.app)).toEqual([]);

  await ctx.app.evaluate(async () => {
    await globalThis.__anyshot?.patch({
      capture: { instantPreview: true, beautify: { modes: { screen: false } } },
    });
  });
  for (const shortcut of ['r', 'f', 'click']) {
    await movePointer(150, 150);
    await dispatch(ctx.app, 'captureArea');
    const overlay = await pageOf(ctx.app, 'overlay');
    await expect(overlay.getByText(/Drag to select an area/)).toBeVisible();
    if (shortcut === 'click') await overlay.mouse.click(150, 150);
    else await overlay.keyboard.press(shortcut);
    await overlay.getByTestId('fx-beautify').click();
    await expect(overlay.getByTestId('beautify-state')).toHaveText('Off');
    await overlay.keyboard.press('Escape');
    await pressClosing(overlay, 'Escape');
    await expect.poll(() => windowKinds(ctx.app)).toEqual([]);
  }
});

test('makes a patterned mesh, imports an image, and exports the chosen background', async () => {
  const info = test.info();
  const settings = await captureSettings();
  await settings.getByRole('checkbox', { name: /Automatic Beautify/ }).check();
  await settings.getByText('Default background', { exact: true }).click();
  await settings.getByRole('button', { name: 'New gradient' }).click();
  await settings.getByLabel('Gradient type').selectOption('mesh');
  await settings.getByRole('button', { name: 'Color point 1' }).press('Shift+ArrowRight');
  await expect(settings.getByLabel('Point X')).toHaveValue('22');
  const preview = settings.locator('.bg-preview canvas');
  const pixel = () =>
    preview.evaluate((canvas: HTMLCanvasElement) =>
      Array.from(canvas.getContext('2d')?.getImageData(320, 150, 75, 75).data ?? []),
    );
  const unpatterned = await pixel();
  await settings.getByRole('combobox', { name: 'Pattern', exact: true }).selectOption('diamonds');
  await settings.getByRole('combobox', { name: 'Blend mode', exact: true }).selectOption('normal');
  await expect.poll(pixel).not.toEqual(unpatterned);
  await settings.getByLabel('Background name').fill('Harbor mesh');
  await ctx.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL().startsWith('app://local/settings/'))
      ?.setContentSize(760, 880);
  });
  await settings
    .getByText('Gradient designer', { exact: true })
    .evaluate((heading) => heading.scrollIntoView({ block: 'start' }));
  await settings.screenshot({ path: info.outputPath('gradient-designer.png') });
  await settings.getByRole('button', { name: 'Save background' }).click();
  await expect(settings.getByRole('button', { name: 'Harbor mesh', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const image = await settings.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 10;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.fillStyle = '#20b070';
    ctx.fillRect(0, 0, 20, 10);
    return canvas.toDataURL().split(',')[1] ?? '';
  });
  await settings.getByLabel('Background image', { exact: true }).setInputFiles({
    name: 'Mint.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await expect(settings.getByLabel('Background name')).toHaveValue('Mint');
  await settings.getByRole('button', { name: 'Save background' }).click();
  await expect(settings.getByRole('button', { name: 'Mint', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await settings.close();
  await showFixture(ctx.app);
  await movePointer(150, 150);

  const overlay = await selectCard(ctx.app);
  const { scaleFactor } = await overlay.evaluate(() => window.anyshot.invoke('overlay:init'));
  await pressClosing(overlay, 'Enter');
  await expect
    .poll(async () => {
      const shot = await clipboard();
      return { ...shot, expectedColor: nearColor(shot?.corner, [32, 176, 112], 5) };
    })
    .toMatchObject({
      width: Math.round(300 * scaleFactor) + 2 * Math.round(48 * scaleFactor),
      expectedColor: true,
    });
  await expect.poll(() => windowKinds(ctx.app)).toEqual([]);

  await dispatch(ctx.app, 'history');
  const history = await pageOf(ctx.app, 'history');
  await history.getByTestId('history-card').dblclick();
  const editor = await pageOf(ctx.app, 'editor');
  await expect(editor.locator('#frame-background')).toBeVisible();
  await editor.getByTestId('fx-beautify').press('Enter');
  await expect(editor.getByTestId('beautify-none')).toBeFocused();
  await editor.getByRole('button', { name: 'Harbor mesh', exact: true }).click();
  const frame = editor.locator('#frame-background');
  const frameCorner = () =>
    frame.evaluate((canvas: HTMLCanvasElement) => [
      ...(canvas.getContext('2d')?.getImageData(0, 0, 1, 1).data.slice(0, 3) ?? []),
    ]);
  await expect.poll(async () => (await frameCorner())[2]).toBeGreaterThan(40);
  await editor.screenshot({ path: info.outputPath('custom-background-editor.png') });
  await editor.keyboard.press('Escape');
  await editor.keyboard.press('Control+c');
  const meshCorner = await frameCorner();
  await expect.poll(async () => nearColor((await clipboard())?.corner, meshCorner, 6)).toBe(true);
  await editor.getByTestId('fx-beautify').click();
  await editor.getByTestId('beautify-none').click();
  await expect(frame).toBeHidden();
});
