import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { closeFixture, FIXTURE, showFixture } from './fixture';
import {
  dispatch,
  type Launched,
  launch,
  pageOf,
  pressClosing,
  processTypes,
  rendererCount,
  windowKinds,
  verifyAndClose,
} from './harness';

let ctx: Launched;
let saveDir: string;

test.beforeEach(async () => {
  const env: Record<string, string> = test.info().title.includes('desktopCapturer')
    ? { ANYSHOT_CAPTURE_BACKEND: 'desktop-capturer' }
    : {};
  ctx = await launch([], {}, env);
  saveDir = join(ctx.userData, 'shots');
  await ctx.app.evaluate(async (_e, dir) => {
    await globalThis.__anyshot?.patch({
      output: { saveDir: dir },
      capture: { showThumbnail: false },
    });
  }, saveDir);
  await showFixture(ctx.app);
});

test.afterEach(async () => {
  await verifyAndClose(ctx);
});

async function openOverlay(): Promise<Page> {
  await dispatch(ctx.app, 'captureArea');
  const page = await pageOf(ctx.app, 'overlay');
  await expect
    .poll(() =>
      ctx.app.evaluate(() =>
        globalThis.__anyshot?.windows().some((w) => w.kind === 'overlay' && w.visible),
      ),
    )
    .toBe(true);
  return page;
}

async function dragSelect(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('actions')).toBeVisible();
}

/** Reads a PNG (clipboard or file) in main: its size and the RGB of one pixel. */
async function inspectClipboard(x: number, y: number) {
  return ctx.app.evaluate(
    async ({ clipboard, nativeImage }, [x, y]) => {
      for (const item of await clipboard.read()) {
        if (!item.types.includes('image/png')) continue;
        const blob = (await item.getType('image/png')) as Blob;
        const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
        const size = image.getSize();
        const bgra = image.toBitmap();
        const i = (y * size.width + x) * 4;
        return { size, rgb: [bgra[i + 2], bgra[i + 1], bgra[i]] };
      }
      return null;
    },
    [x, y] as const,
  );
}

async function overlaysGone() {
  await expect.poll(() => windowKinds(ctx.app)).not.toContain('overlay');
}

const near = (a: readonly (number | undefined)[] | undefined, b: readonly number[], tol = 6) =>
  !!a && a.every((v, i) => Math.abs((v ?? -999) - (b[i] ?? 0)) <= tol);

test('drag-select and copy puts the exact region on the clipboard', async () => {
  const page = await openOverlay();
  // State set right after the first render must reach the UI (regression: hint never showed).
  await expect(page.getByText(/Drag to select an area/)).toBeVisible();
  const { card } = FIXTURE;
  await dragSelect(
    page,
    { x: card.x, y: card.y },
    { x: card.x + card.width, y: card.y + card.height },
  );
  await page.getByTestId('action-copy').click();
  await overlaysGone();
  const shot = await inspectClipboard(150, 100);
  expect(shot?.size).toEqual({ width: card.width, height: card.height });
  expect(near(shot?.rgb, card.rgb)).toBe(true);
});

test('Ctrl+S saves a PNG into the configured folder', async () => {
  const page = await openOverlay();
  await dragSelect(page, { x: 50, y: 50 }, { x: 250, y: 150 });
  await pressClosing(page, 'Control+s');
  await overlaysGone();
  await expect.poll(async () => (await readdir(saveDir).catch(() => [])).length).toBe(1);
  const [file] = await readdir(saveDir);
  expect(file).toMatch(/^anyshot .+\.png$/);
  const info = await ctx.app.evaluate(
    ({ nativeImage }, path) => {
      const image = nativeImage.createFromPath(path);
      const bgra = image.toBitmap();
      const size = image.getSize();
      // (10, 10) is fixture background; (100, 80) is screen (150, 130), inside the card.
      const px = (x: number, y: number) => {
        const i = (y * size.width + x) * 4;
        return [bgra[i + 2], bgra[i + 1], bgra[i]];
      };
      return { size, bg: px(10, 10), card: px(100, 80) };
    },
    join(saveDir, file ?? ''),
  );
  expect(info.size).toEqual({ width: 200, height: 100 });
  expect(near(info.bg, FIXTURE.background)).toBe(true);
  expect(near(info.card, FIXTURE.card.rgb)).toBe(true);
});

test('annotations are drawn into the output and undo removes them', async () => {
  const page = await openOverlay();
  await dragSelect(page, { x: 60, y: 60 }, { x: 460, y: 360 });
  await page.getByTestId('tool-rect').click();
  await page.getByTestId('color').click();
  await page.getByTitle('#ffcc00').click();
  // Filled rectangle so the check doesn't depend on stroke anti-aliasing.
  await page.getByRole('button', { name: 'Fill', exact: true }).click();
  await page.mouse.move(120, 120);
  await page.mouse.down();
  await page.mouse.move(200, 200, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('undo')).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('undo')).toBeDisabled();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('undo')).toBeEnabled();
  await pressClosing(page, 'Control+c');
  await overlaysGone();
  // (100, 100) in output = (160, 160) on screen: inside the yellow rectangle.
  const shot = await inspectClipboard(100, 100);
  expect(shot?.size).toEqual({ width: 400, height: 300 });
  expect(near(shot?.rgb, [255, 204, 0])).toBe(true);
});

test('Esc cancels, and renderer processes return to baseline', async () => {
  await closeFixture(ctx.app);
  await expect
    .poll(async () => rendererCount(await processTypes(ctx.app)), { timeout: 30_000 })
    .toBe(0);
  for (let i = 0; i < 5; i++) {
    const page = await openOverlay();
    await pressClosing(page, 'Escape');
    await overlaysGone();
  }
  await expect
    .poll(async () => rendererCount(await processTypes(ctx.app)), { timeout: 30_000 })
    .toBe(0);
  expect(await ctx.app.evaluate(() => globalThis.__anyshot?.frameCount())).toBe(0);
  const timings = await ctx.app.evaluate(() => globalThis.__anyshot?.timings.hotkeyToOverlay ?? []);
  console.log(
    'hotkey → overlay ms (low-memory mode, Xvfb):',
    timings.map((t) => Math.round(t)).join(', '),
  );
  expect(timings.length).toBe(5);
  // Budget is 500 ms on real hardware; leave headroom for slow CI runners.
  expect(Math.min(...timings)).toBeLessThan(1500);
});

test('the desktopCapturer fallback produces the same pixels', async () => {
  const page = await openOverlay();
  const { card } = FIXTURE;
  await dragSelect(
    page,
    { x: card.x, y: card.y },
    { x: card.x + card.width, y: card.y + card.height },
  );
  await page.getByTestId('action-copy').click();
  await overlaysGone();
  const shot = await inspectClipboard(150, 100);
  expect(shot?.size).toEqual({ width: card.width, height: card.height });
  expect(near(shot?.rgb, card.rgb)).toBe(true);
});

test('invert, beautify and censor change the exported image', async () => {
  const { card } = FIXTURE;
  let page = await openOverlay();
  await dragSelect(
    page,
    { x: card.x, y: card.y },
    { x: card.x + card.width, y: card.y + card.height },
  );
  await page.getByTestId('fx-invert').click();
  await expect(page.getByTestId('fx-invert')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('fx-beautify').click();
  await page.getByTestId('beautify-popover').getByRole('button', { name: 'Background 1' }).click();
  await pressClosing(page, 'Control+c');
  await overlaysGone();
  // Padding 48 on each side at unit 1; the card is inverted inside the frame.
  const framed = await inspectClipboard(48 + 150, 48 + 100);
  expect(framed?.size).toEqual({ width: card.width + 96, height: card.height + 96 });
  expect(
    near(
      framed?.rgb,
      card.rgb.map((v) => 255 - v),
    ),
  ).toBe(true);

  page = await openOverlay();
  await dragSelect(page, { x: 450, y: 150 }, { x: 1150, y: 450 });
  // Effects are per capture: a new capture starts plain.
  await expect(page.getByTestId('fx-invert')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('tool-censor').click();
  await page.getByRole('button', { name: 'Solid', exact: true }).click();
  await page.mouse.move(470, 170);
  await page.mouse.down();
  await page.mouse.move(1130, 430, { steps: 4 });
  await page.mouse.up();
  await pressClosing(page, 'Control+c');
  await overlaysGone();
  const censored = await inspectClipboard(350, 150);
  expect(near(censored?.rgb, [17, 17, 17])).toBe(true);
});
