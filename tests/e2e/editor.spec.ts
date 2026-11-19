import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { packProject } from '../../src/shared/project';
import { FIXTURE, showFixture } from './fixture';
import { dispatch, type Launched, launch, pageOf, pressClosing, windowKinds } from './harness';

let ctx: Launched;

test.beforeEach(async () => {
  ctx = await launch();
  await ctx.app.evaluate(async () => {
    await globalThis.__anyshot?.patch({ capture: { showThumbnail: false } });
  });
  await showFixture(ctx.app);
});

test.afterEach(async () => {
  expect(ctx.errors).toEqual([]);
  await ctx.close();
});

async function clipboardPixel(x: number, y: number) {
  return ctx.app.evaluate(
    async ({ clipboard, nativeImage }, [x, y]) => {
      for (const item of await clipboard.read()) {
        if (!item.types.includes('image/png')) continue;
        const blob = (await item.getType('image/png')) as Blob;
        const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
        const size = image.getSize();
        const bgra = image.toBitmap();
        const i = (y * size.width + x) * 4;
        return { size, rgb: [bgra[i + 2] ?? -1, bgra[i + 1] ?? -1, bgra[i] ?? -1] };
      }
      return null;
    },
    [x, y] as const,
  );
}

const near = (a: number[] | undefined, b: readonly number[]) =>
  !!a && a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= 6);

/** Captures the fixture card with a yellow filled rectangle and opens it in the editor. */
async function editorWithAnnotation(): Promise<Page> {
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
  await overlay.getByTestId('tool-rect').click();
  await overlay.getByTestId('color').click();
  await overlay.getByTitle('#ffcc00').click();
  await overlay.getByRole('button', { name: 'Fill', exact: true }).click();
  await overlay.mouse.move(card.x + 20, card.y + 20);
  await overlay.mouse.down();
  await overlay.mouse.move(card.x + 80, card.y + 80, { steps: 4 });
  await overlay.mouse.up();
  await pressClosing(overlay, 'e');
  const editor = await pageOf(ctx.app, 'editor');
  await expect(editor.getByTestId('editor-size')).toHaveText('300 × 200');
  return editor;
}

test('open in editor keeps annotations editable and copies the result', async () => {
  const editor = await editorWithAnnotation();
  expect(await windowKinds(ctx.app)).toEqual(['editor']);
  await editor.getByTestId('editor-copy').click();
  await expect(editor.getByTestId('editor-status')).toHaveText('Copied to the clipboard');
  const shot = await clipboardPixel(50, 50);
  expect(shot?.size).toEqual({ width: 300, height: 200 });
  expect(near(shot?.rgb, [255, 204, 0])).toBe(true);
  // The annotation is still an object: select it and delete it.
  await editor.getByTestId('tool-select').click();
  const box = await editor.locator('#clip').boundingBox();
  if (!box) throw new Error('no canvas');
  const s = box.width / 300;
  await editor.mouse.click(box.x + 50 * s, box.y + 50 * s);
  await editor.keyboard.press('Delete');
  await editor.getByTestId('editor-copy').click();
  await expect
    .poll(async () => near((await clipboardPixel(50, 50))?.rgb, FIXTURE.card.rgb))
    .toBe(true);
});

test('crop applies to the output and undoes in one step', async () => {
  const editor = await editorWithAnnotation();
  await editor.keyboard.press('c');
  const box = await editor.locator('#clip').boundingBox();
  if (!box) throw new Error('no canvas');
  await editor.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await editor.mouse.down();
  await editor.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 4 });
  await editor.mouse.up();
  await editor.getByTestId('crop-apply').click();
  await expect(editor.getByTestId('editor-size')).toHaveText(/^1(49|50|51) × (99|100|101)$/);
  await editor.keyboard.press('Control+c');
  await expect.poll(async () => (await clipboardPixel(0, 0))?.size.width).toBeLessThan(160);
  await editor.keyboard.press('Control+z');
  await expect(editor.getByTestId('editor-size')).toHaveText('300 × 200');
});

test('projects save and reopen with editable annotations', async () => {
  const editor = await editorWithAnnotation();
  const file = join(ctx.userData, 'shot.anyshot');
  await ctx.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: path,
    })) as typeof dialog.showSaveDialog;
  }, file);
  await editor.getByTestId('save-project').click();
  await expect(editor.getByTestId('editor-status')).toContainText('Project saved');
  const bytes = await readFile(file);
  expect(bytes.subarray(0, 8).toString()).toBe('ANYSHOT1');
  await pressClosing(editor, 'Control+w');
  await expect.poll(() => windowKinds(ctx.app)).toEqual([]);

  await dispatch(ctx.app, 'openImage', file);
  const reopened = await pageOf(ctx.app, 'editor');
  await expect(reopened.getByTestId('editor-size')).toHaveText('300 × 200');
  await reopened.getByTestId('tool-select').click();
  const box = await reopened.locator('#clip').boundingBox();
  if (!box) throw new Error('no canvas');
  const s = box.width / 300;
  await reopened.mouse.click(box.x + 50 * s, box.y + 50 * s);
  await reopened.keyboard.press('Delete');
  await expect(reopened.getByTestId('undo')).toBeEnabled();
});

test('a project with an invalid crop cannot expose the uncropped image', async () => {
  const png = await ctx.app.evaluate(({ nativeImage }) =>
    nativeImage
      .createFromBitmap(Buffer.alloc(16, 255), { width: 2, height: 2 })
      .toPNG()
      .toString('base64'),
  );
  const path = join(ctx.userData, 'invalid-crop.anyshot');
  await writeFile(
    path,
    packProject({
      doc: { version: 1, annotations: [], crop: { x: 0, y: 0, width: 0, height: 2 } },
      image: { mime: 'image/png', width: 2, height: 2 },
      bytes: Buffer.from(png, 'base64'),
    }),
  );
  await dispatch(ctx.app, 'openImage', path);
  const editor = await pageOf(ctx.app, 'editor');
  await expect(
    editor.getByText('anyshot could not open this project because its crop is invalid.'),
  ).toBeVisible();
  await expect(editor.getByTestId('editor-copy')).toHaveCount(0);
  await expect(editor.locator('canvas')).toHaveCount(0);
});
