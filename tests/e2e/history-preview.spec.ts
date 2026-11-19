import { expect, type Page, test } from '@playwright/test';
import { FIXTURE, showFixture } from './fixture';
import {
  dispatch,
  type Launched,
  launch,
  pageOf,
  pressClosing,
  verifyAndClose,
  windowKinds,
} from './harness';

let ctx: Launched;

test.beforeEach(async () => {
  ctx = await launch();
  await ctx.app.evaluate(async () => {
    await globalThis.__anyshot?.patch({ capture: { showThumbnail: false } });
  });
  await showFixture(ctx.app);
});

test.afterEach(async () => {
  await verifyAndClose(ctx);
});

/** Captures a width × height area of the fixture card and copies it. */
async function capture(width: number, height: number): Promise<void> {
  await expect.poll(() => windowKinds(ctx.app)).not.toContain('overlay');
  await dispatch(ctx.app, 'captureArea');
  const overlay = await pageOf(ctx.app, 'overlay');
  await expect
    .poll(() =>
      ctx.app.evaluate(() =>
        globalThis.__anyshot?.windows().some((w) => w.kind === 'overlay' && w.visible),
      ),
    )
    .toBe(true);
  const { x, y } = FIXTURE.card;
  await overlay.mouse.move(x, y);
  await overlay.mouse.down();
  await overlay.mouse.move(x + width, y + height, { steps: 4 });
  await overlay.mouse.up();
  await pressClosing(overlay, 'Control+c');
}

async function clipboardSize() {
  return ctx.app.evaluate(async ({ clipboard, nativeImage }) => {
    for (const item of await clipboard.read()) {
      if (!item.types.includes('image/png')) continue;
      const blob = (await item.getType('image/png')) as Blob;
      return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).getSize();
    }
    return null;
  });
}

async function openHistory(): Promise<Page> {
  await capture(300, 200);
  await capture(200, 100);
  await capture(100, 50);
  await dispatch(ctx.app, 'history');
  const history = await pageOf(ctx.app, 'history');
  await expect(history.getByTestId('history-card')).toHaveCount(3);
  return history;
}

test('clicking a capture opens a preview that moves with the arrows and runs actions', async () => {
  const history = await openHistory();
  const fullImages: string[] = [];
  history.on('request', (r) => {
    if (r.url().endsWith('/image')) fullImages.push(r.url());
  });
  // The grid shows thumbnails only.
  for (const src of await history
    .locator('.grid img')
    .evaluateAll((imgs) => imgs.map((img) => img.getAttribute('src'))))
    expect(src).toMatch(/\/thumb$/);

  await history.getByTestId('history-card').first().click();
  const preview = history.getByTestId('preview');
  const meta = history.getByTestId('preview-meta');
  await expect(preview).toBeVisible();
  await expect(meta).toContainText('100 × 50');
  await expect(history.getByRole('dialog')).toBeFocused();
  const image = history.getByTestId('preview-image');
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(100);
  expect(fullImages).toHaveLength(1);

  await history.keyboard.press('ArrowRight');
  await expect(meta).toContainText('200 × 100');
  await expect(history.getByText('2 / 3')).toBeVisible();
  await ctx.app.evaluate(({ clipboard }) => clipboard.clear());
  await history.getByTestId('preview-copy').click();
  await expect(history.getByText('Copied to the clipboard')).toBeVisible();
  await expect.poll(clipboardSize).toEqual({ width: 200, height: 100 });

  await history.keyboard.press('ArrowLeft');
  await expect(meta).toContainText('100 × 50');
  await history.getByTestId('preview-delete').click();
  await expect(history.getByTestId('history-card')).toHaveCount(2);
  // The preview stays open on the entry that took the deleted one's place.
  await expect(meta).toContainText('200 × 100');

  await history.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  expect(await windowKinds(ctx.app)).toContain('history');
  await expect(history.getByTestId('history-card').first()).toBeFocused();

  // Space opens the quick look for the selected capture; a click outside closes it.
  await history.keyboard.press('Space');
  await expect(meta).toContainText('200 × 100');
  await history.mouse.click(5, 5);
  await expect(preview).toHaveCount(0);
});

test('double-clicking a capture opens it in the editor', async () => {
  const history = await openHistory();
  await history.getByTestId('history-card').nth(1).dblclick();
  const editor = await pageOf(ctx.app, 'editor');
  await expect(editor.getByTestId('editor-size')).toHaveText('200 × 100');
  await expect(history.getByTestId('preview')).toHaveCount(0);
});
