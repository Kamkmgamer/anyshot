import { readdir, readFile } from 'node:fs/promises';
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
} from './harness';

let ctx: Launched;
let saveDir: string;

test.beforeEach(async () => {
  ctx = await launch();
  saveDir = join(ctx.userData, 'shots');
  await ctx.app.evaluate(async (_e, dir) => {
    await globalThis.__anyshot?.patch({
      output: { saveDir: dir },
      capture: { thumbnailDismissSeconds: 0 },
    });
  }, saveDir);
  await showFixture(ctx.app);
});

test.afterEach(async () => {
  expect(ctx.errors).toEqual([]);
  await ctx.close();
});

async function captureCard(): Promise<Page> {
  await expect.poll(() => windowKinds(ctx.app)).not.toContain('overlay');
  await dispatch(ctx.app, 'captureArea');
  const page = await pageOf(ctx.app, 'overlay');
  await expect
    .poll(() =>
      ctx.app.evaluate(() =>
        globalThis.__anyshot?.windows().some((w) => w.kind === 'overlay' && w.visible),
      ),
    )
    .toBe(true);
  const { card } = FIXTURE;
  await page.mouse.move(card.x, card.y);
  await page.mouse.down();
  await page.mouse.move(card.x + card.width, card.y + card.height, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('actions')).toBeVisible();
  return page;
}

async function historyIndex(): Promise<{ id: string; width: number; savedPath: string | null }[]> {
  return JSON.parse(await readFile(join(ctx.userData, 'history', 'index.json'), 'utf8'));
}

test('a capture lands in history and shows a floating preview that can save', async () => {
  const overlay = await captureCard();
  await pressClosing(overlay, 'Control+c');
  const floating = await pageOf(ctx.app, 'floating');
  await expect(floating.getByTestId('floating-card')).toHaveCount(1);
  const [entry] = await historyIndex();
  expect(entry?.width).toBe(FIXTURE.card.width);
  const files = await readdir(join(ctx.userData, 'history'));
  expect(files).toEqual(expect.arrayContaining([`${entry?.id}.png`, `${entry?.id}.thumb.webp`]));
  // The thumbnail is served over app:// and actually decodes.
  await expect
    .poll(() => floating.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  await floating.getByTestId('floating-save').click();
  await expect.poll(async () => (await readdir(saveDir).catch(() => [])).length).toBe(1);
  await expect.poll(async () => (await historyIndex())[0]?.savedPath).toContain(saveDir);

  await floating.getByRole('button', { name: 'Close' }).click();
  await expect.poll(() => windowKinds(ctx.app)).not.toContain('floating');
});

test('pin keeps the capture on screen where it was taken, and Esc closes it', async () => {
  const overlay = await captureCard();
  await pressClosing(overlay, 'f');
  const pin = await pageOf(ctx.app, 'pin');
  await expect(pin.getByTestId('pin')).toBeVisible();
  const bounds = await ctx.app.evaluate(
    () => globalThis.__anyshot?.windows().find((w) => w.kind === 'pin')?.bounds,
  );
  expect(bounds).toMatchObject({
    x: FIXTURE.card.x,
    y: FIXTURE.card.y,
    width: FIXTURE.card.width,
    height: FIXTURE.card.height,
  });
  expect(await windowKinds(ctx.app)).not.toContain('floating');
  await pressClosing(pin, 'Escape');
  await expect.poll(() => windowKinds(ctx.app)).toEqual([]);
});

test('closing previews and pins returns to no renderers', async () => {
  await closeFixture(ctx.app);
  const overlay = await captureCard();
  await pressClosing(overlay, 'f');
  const pin = await pageOf(ctx.app, 'pin');
  await pressClosing(pin, 'Escape');
  const again = await captureCard();
  await pressClosing(again, 'Control+c');
  const floating = await pageOf(ctx.app, 'floating');
  await floating.getByRole('button', { name: 'Close' }).click();
  await expect.poll(() => windowKinds(ctx.app)).toEqual([]);
  await expect
    .poll(async () => rendererCount(await processTypes(ctx.app)), { timeout: 30_000 })
    .toBe(0);
});

test('history lists captures lazily and supports copy and delete', async () => {
  for (let i = 0; i < 2; i++) {
    const overlay = await captureCard();
    await pressClosing(overlay, 'Control+c');
  }
  await dispatch(ctx.app, 'history');
  const history = await pageOf(ctx.app, 'history');
  await expect(history.getByTestId('history-card')).toHaveCount(2);
  await expect(history.locator('img').first()).toHaveAttribute('loading', 'lazy');
  // Clear the clipboard, then copy the selected entry back with Enter.
  await ctx.app.evaluate(({ clipboard }) => clipboard.writeText('x'));
  await history.keyboard.press('Enter');
  await expect(history.getByText('Copied to the clipboard')).toBeVisible();
  const hasImage = await ctx.app.evaluate(({ clipboard }) => clipboard.has('image/png'));
  expect(hasImage).toBe(true);
  await history.keyboard.press('Delete');
  await expect(history.getByTestId('history-card')).toHaveCount(1);
  expect(await historyIndex()).toHaveLength(1);
  await dispatch(ctx.app, 'history');
  expect((await windowKinds(ctx.app)).filter((k) => k === 'history')).toHaveLength(1);
  // A capture finished while History is open shows up without reopening it.
  const overlay = await captureCard();
  await pressClosing(overlay, 'Control+c');
  await expect(history.getByTestId('history-card')).toHaveCount(2);
});
