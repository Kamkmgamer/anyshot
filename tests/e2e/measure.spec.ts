import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { unpackProject } from '../../src/shared/project';
import { FIXTURE, showFixture } from './fixture';
import { dispatch, type Launched, launch, pageOf, pressClosing, verifyAndClose } from './harness';

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

async function drag(page: Page, a: [number, number], b: [number, number]): Promise<void> {
  await page.mouse.move(...a);
  await page.mouse.down();
  await page.mouse.move(...b, { steps: 6 });
  await page.mouse.up();
}

/** Selects the fixture card in a fresh overlay. */
async function overlayOnCard(): Promise<Page> {
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
  await drag(overlay, [card.x, card.y], [card.x + card.width, card.y + card.height]);
  return overlay;
}

/** Saves the editor's project and returns its measure annotations. */
async function savedMeasures(editor: Page) {
  const file = join(ctx.userData, `measure-${Date.now()}.anyshot`);
  await ctx.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: path,
    })) as typeof dialog.showSaveDialog;
  }, file);
  await editor.getByTestId('save-project').click();
  await expect(editor.getByTestId('editor-status')).toContainText('Project saved');
  const { doc } = unpackProject(await readFile(file));
  const annotations = (doc as { annotations: { kind: string; a: unknown; b: unknown }[] })
    .annotations;
  return annotations.filter((a) => a.kind === 'measure');
}

test('measurements stay inside the selection in the overlay', async () => {
  const overlay = await overlayOnCard();
  const { card } = FIXTURE;
  await overlay.getByTestId('tool-measure').click();
  // Starts inside, released far outside the selection (below and to the right).
  await drag(overlay, [card.x + 50, card.y + 100], [card.x + card.width + 150, card.y + 100]);
  await pressClosing(overlay, 'e');
  const editor = await pageOf(ctx.app, 'editor');
  await expect(editor.getByTestId('editor-size')).toHaveText('300 × 200');
  const [measure] = await savedMeasures(editor);
  expect(measure?.a).toEqual({ x: expect.closeTo(50, 0), y: expect.closeTo(100, 0) });
  // Pointer coordinates carry sub-pixel noise; the clamped coordinate is exact.
  expect(measure?.b).toEqual({ x: 300, y: expect.closeTo(100, 0) });
});

test('measurements start and end at the image edge in the editor', async () => {
  const overlay = await overlayOnCard();
  await pressClosing(overlay, 'e');
  const editor = await pageOf(ctx.app, 'editor');
  await expect(editor.getByTestId('editor-size')).toHaveText('300 × 200');
  await editor.getByTestId('tool-measure').click();
  const box = await editor.locator('#clip').boundingBox();
  if (!box) throw new Error('no canvas');
  const scale = box.width / 300;
  const y = box.y + 80 * scale;
  // From the grey margin left of the image to beyond its right edge.
  await drag(editor, [box.x - 15, y], [box.x + box.width + 15, y]);
  const [measure] = await savedMeasures(editor);
  expect(measure?.a).toEqual({ x: 0, y: expect.closeTo(80, 0) });
  expect(measure?.b).toEqual({ x: 300, y: expect.closeTo(80, 0) });
});
