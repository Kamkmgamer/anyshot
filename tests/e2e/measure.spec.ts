import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { unpackProject } from '../../src/shared/project';
import { FIXTURE, showFixture } from './fixture';
import { type Launched, launch, pageOf, pressClosing, selectCard, verifyAndClose } from './harness';

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
  const overlay = await selectCard(ctx.app);
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
  const overlay = await selectCard(ctx.app);
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

test('moving a measurement stops at the image edge', async () => {
  await pressClosing(await selectCard(ctx.app), 'e');
  const editor = await pageOf(ctx.app, 'editor');
  await expect(editor.getByTestId('editor-size')).toHaveText('300 × 200');
  const box = await editor.locator('#clip').boundingBox();
  if (!box) throw new Error('no canvas');
  const s = box.width / 300;
  const at = (x: number, y: number): [number, number] => [box.x + x * s, box.y + y * s];
  await editor.getByTestId('tool-measure').click();
  await drag(editor, at(50, 100), at(150, 100));
  await editor.getByTestId('tool-select').click();
  // Grab the middle of the line and drag far below and to the right of the image.
  await drag(editor, at(100, 100), at(400, 400));
  const [measure] = await savedMeasures(editor);
  // Float arithmetic on the clamped delta: exact to well below a pixel.
  expect(measure?.b).toEqual({ x: expect.closeTo(300, 6), y: expect.closeTo(200, 6) });
  expect(measure?.a).toEqual({ x: expect.closeTo(200, 0), y: expect.closeTo(200, 6) });
});

test('arrow-key nudges keep a measurement inside the image', async () => {
  await pressClosing(await selectCard(ctx.app), 'e');
  const editor = await pageOf(ctx.app, 'editor');
  await expect(editor.getByTestId('editor-size')).toHaveText('300 × 200');
  const box = await editor.locator('#clip').boundingBox();
  if (!box) throw new Error('no canvas');
  const s = box.width / 300;
  const at = (x: number, y: number): [number, number] => [box.x + x * s, box.y + y * s];
  await editor.getByTestId('tool-measure').click();
  await drag(editor, at(50, 100), at(250, 100));
  await editor.getByTestId('tool-select').click();
  await editor.mouse.click(...at(150, 100));
  // 10 × Shift+→ asks for 100 px; only 50 px are left before the right edge.
  for (let i = 0; i < 10; i++) await editor.keyboard.press('Shift+ArrowRight');
  const [measure] = await savedMeasures(editor);
  // The right end stops at the edge; the line keeps its length and stays horizontal.
  const a = measure?.a as { x: number; y: number };
  const b = measure?.b as { x: number; y: number };
  expect(b.x).toBeCloseTo(300, 6);
  expect(b.x - a.x).toBeCloseTo(200, 0);
  expect(b.y).toBe(a.y);
});

test('a nudge during a drag still leaves the measurement inside the image', async () => {
  await pressClosing(await selectCard(ctx.app), 'e');
  const editor = await pageOf(ctx.app, 'editor');
  await expect(editor.getByTestId('editor-size')).toHaveText('300 × 200');
  const box = await editor.locator('#clip').boundingBox();
  if (!box) throw new Error('no canvas');
  const s = box.width / 300;
  const at = (x: number, y: number): [number, number] => [box.x + x * s, box.y + y * s];
  await editor.getByTestId('tool-measure').click();
  await drag(editor, at(50, 100), at(250, 100));
  await editor.getByTestId('tool-select').click();
  // Grab the line and drag 40 px right (allowed alone), then nudge 50 px right mid-drag.
  await editor.mouse.move(...at(150, 100));
  await editor.mouse.down();
  await editor.mouse.move(...at(190, 100), { steps: 4 });
  for (let i = 0; i < 5; i++) await editor.keyboard.press('Shift+ArrowRight');
  await editor.mouse.up();
  const [measure] = await savedMeasures(editor);
  const a = measure?.a as { x: number; y: number };
  const b = measure?.b as { x: number; y: number };
  expect(b.x).toBeLessThanOrEqual(300 + 1e-6);
  expect(b.x - a.x).toBeCloseTo(200, 0);
});
