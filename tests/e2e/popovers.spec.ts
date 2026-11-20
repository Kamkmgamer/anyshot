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

/** Selects the fixture card in a fresh overlay. */
async function overlayWithSelection(): Promise<Page> {
  await dispatch(ctx.app, 'captureArea');
  const overlay = await pageOf(ctx.app, 'overlay');
  await expect
    .poll(() =>
      ctx.app.evaluate(() =>
        globalThis.__anyshot?.windows().some((w) => w.kind === 'overlay' && w.visible),
      ),
    )
    .toBe(true);
  const { card } = FIXTURE;
  await overlay.mouse.move(card.x, card.y);
  await overlay.mouse.down();
  await overlay.mouse.move(card.x + card.width, card.y + card.height, { steps: 5 });
  await overlay.mouse.up();
  return overlay;
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test('overlay popovers close on a press outside them, without drawing, and on Esc', async () => {
  const overlay = await overlayWithSelection();
  const { card } = FIXTURE;
  await overlay.getByTestId('tool-rect').click();

  // A press inside the popover keeps it open.
  await overlay.getByTestId('fx-beautify').click();
  const beautify = overlay.getByTestId('beautify-popover');
  await beautify.locator('.hint').click();
  await expect(beautify).toBeVisible();
  await expect(overlay.getByTestId('undo')).toBeDisabled();

  // A drag on the image only closes the popover: it doesn't draw a rectangle.
  await drag(overlay, { x: card.x + 40, y: card.y + 40 }, { x: card.x + 120, y: card.y + 120 });
  await expect(beautify).toHaveCount(0);
  await expect(overlay.getByTestId('undo')).toBeDisabled();
  // With no popover open, the same drag draws.
  await drag(overlay, { x: card.x + 40, y: card.y + 40 }, { x: card.x + 120, y: card.y + 120 });
  await expect(overlay.getByTestId('undo')).toBeEnabled();

  // Esc closes the popover and leaves the capture open; the next Esc cancels it.
  await overlay.getByTestId('color').click();
  await expect(overlay.getByTestId('color-popover')).toBeVisible();
  await overlay.keyboard.press('Escape');
  await expect(overlay.getByTestId('color-popover')).toHaveCount(0);
  expect(await windowKinds(ctx.app)).toContain('overlay');
  await pressClosing(overlay, 'Escape');
  await expect.poll(() => windowKinds(ctx.app)).toEqual([]);
});

test('editor popovers close on a press outside them, and their buttons still toggle', async () => {
  const overlay = await overlayWithSelection();
  await pressClosing(overlay, 'e');
  const editor = await pageOf(ctx.app, 'editor');
  await expect(editor.getByTestId('editor-size')).toHaveText('300 × 200');

  const adjust = editor.getByTestId('adjust-popover');
  const beautify = editor.getByTestId('beautify-popover');
  await editor.getByTestId('fx-adjust').click();
  await expect(editor.getByTestId('fx-adjust')).toHaveAttribute('aria-expanded', 'true');
  // The button announces a dialog, and the popover is one, named after it.
  await expect(editor.getByRole('dialog', { name: 'Adjust' })).toBeVisible();
  await adjust.getByRole('button', { name: 'Mono' }).click();
  await expect(adjust).toBeVisible();
  // Its own button closes it again.
  await editor.getByTestId('fx-adjust').click();
  await expect(adjust).toHaveCount(0);
  await expect(editor.getByTestId('fx-adjust')).toHaveAttribute('aria-expanded', 'false');

  // Another popover's button swaps one for the other.
  await editor.getByTestId('fx-adjust').click();
  await editor.getByTestId('fx-beautify').click();
  await expect(adjust).toHaveCount(0);
  await expect(beautify).toBeVisible();

  // Another tool closes it and is still chosen.
  await editor.getByTestId('tool-ellipse').click();
  await expect(beautify).toHaveCount(0);
  await expect(editor.getByTestId('tool-ellipse')).toHaveAttribute('aria-pressed', 'true');

  // A click on the empty area around the image closes it too.
  await editor.getByTestId('color').click();
  await expect(editor.getByTestId('color-popover')).toBeVisible();
  const box = await editor.locator('#viewport').boundingBox();
  if (!box) throw new Error('no viewport');
  await editor.mouse.click(box.x + 8, box.y + box.height - 8);
  await expect(editor.getByTestId('color-popover')).toHaveCount(0);

  // Esc closes it and keeps the editor open.
  await editor.getByTestId('fx-beautify').click();
  await editor.keyboard.press('Escape');
  await expect(beautify).toHaveCount(0);
  expect(await windowKinds(ctx.app)).toEqual(['editor']);
});
