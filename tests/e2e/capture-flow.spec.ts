import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURE, showFixture } from './fixture';
import { dispatch, type Launched, launch, pageOf, verifyAndClose, windowKinds } from './harness';

let ctx: Launched;

test.beforeEach(async () => {
  // The default flow: instant preview off.
  ctx = await launch([], { capture: { instantPreview: false, thumbnailDismissSeconds: 0 } });
  // The X clipboard outlives earlier specs.
  await ctx.app.evaluate(({ clipboard }) => clipboard.clear());
  await showFixture(ctx.app);
});

test.afterEach(async () => {
  await verifyAndClose(ctx);
});

async function overlayShown() {
  await expect
    .poll(() =>
      ctx.app.evaluate(() =>
        globalThis.__anyshot?.windows().some((w) => w.kind === 'overlay' && w.visible),
      ),
    )
    .toBe(true);
}

async function dragCard() {
  await expect.poll(() => windowKinds(ctx.app)).not.toContain('overlay');
  await dispatch(ctx.app, 'captureArea');
  const overlay = await pageOf(ctx.app, 'overlay');
  await overlayShown();
  const { card } = FIXTURE;
  await overlay.mouse.move(card.x, card.y);
  await overlay.mouse.down();
  await overlay.mouse.move(card.x + card.width, card.y + card.height, { steps: 5 });
  await overlay.mouse.up();
  return overlay;
}

async function historyWidths(): Promise<number[]> {
  const index = JSON.parse(await readFile(join(ctx.userData, 'history', 'index.json'), 'utf8'));
  return (index as { width: number }[]).map((e) => e.width);
}

async function clipboardWidth(): Promise<number | null> {
  return ctx.app.evaluate(async ({ clipboard, nativeImage }) => {
    for (const item of await clipboard.read()) {
      if (!item.types.includes('image/png')) continue;
      const blob = (await item.getType('image/png')) as Blob;
      return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).getSize().width;
    }
    return null;
  });
}

test('selecting an area captures it at once and shows the thumbnail, whose Edit opens the editor', async () => {
  await dragCard();
  // No edit tools on the selection: the overlay closes and the quick action (copy) ran.
  await expect.poll(() => windowKinds(ctx.app)).not.toContain('overlay');
  await expect.poll(clipboardWidth).toBe(FIXTURE.card.width);
  await expect.poll(historyWidths).toEqual([FIXTURE.card.width]);
  const floating = await pageOf(ctx.app, 'floating');
  await expect(floating.getByTestId('floating-card')).toHaveCount(1);

  await floating.getByTestId('floating-card').hover();
  await floating.getByTestId('floating-edit').click();
  const editor = await pageOf(ctx.app, 'editor');
  await expect(editor.getByTestId('editor-size')).toHaveText(
    `${FIXTURE.card.width} × ${FIXTURE.card.height}`,
  );
  await expect.poll(() => windowKinds(ctx.app)).not.toContain('floating');
});

test('full-screen capture is immediate too', async () => {
  const display = await ctx.app.evaluate(({ screen }) => screen.getPrimaryDisplay().size);
  await dispatch(ctx.app, 'captureScreen');
  const floating = await pageOf(ctx.app, 'floating');
  await expect(floating.getByTestId('floating-card')).toHaveCount(1);
  await expect.poll(historyWidths).toEqual([display.width]);
  expect(await windowKinds(ctx.app)).not.toContain('overlay');
});

test('with instant preview on, the selection keeps the edit tools', async () => {
  await ctx.app.evaluate(async () => {
    await globalThis.__anyshot?.patch({ capture: { instantPreview: true } });
  });
  const overlay = await dragCard();
  await expect(overlay.getByTestId('actions')).toBeVisible();
  expect(await windowKinds(ctx.app)).not.toContain('floating');
  expect(await clipboardWidth()).toBeNull();
});
