import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { FIXTURE, showFixture } from './fixture';
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

let ctx: Launched;

test.beforeEach(async () => {
  ctx = await launch();
  await ctx.app.evaluate(
    async (_e, dir) => {
      await globalThis.__anyshot?.patch({
        capture: { showThumbnail: false },
        output: { saveDir: dir },
      });
    },
    join(ctx.userData, 'shots'),
  );
  await showFixture(ctx.app);
});

test.afterEach(async () => {
  await verifyAndClose(ctx);
});

const YELLOW = [255, 204, 0] as const;
const near = (a: number[] | undefined, b: readonly number[]) =>
  !!a && a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= 6);

/** Copies from the editor and reads one pixel of the clipboard image. */
async function copiedPixel(editor: Page, x: number, y: number): Promise<number[] | undefined> {
  await ctx.app.evaluate(({ clipboard }) => clipboard.clear());
  await editor.getByTestId('editor-copy').click();
  await expect(editor.getByTestId('editor-status')).toHaveText('Copied to the clipboard');
  await editor.getByTestId('editor-status').click();
  return ctx.app.evaluate(
    async ({ clipboard, nativeImage }, [x, y]) => {
      for (const item of await clipboard.read()) {
        if (!item.types.includes('image/png')) continue;
        const blob = (await item.getType('image/png')) as Blob;
        const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
        const bgra = image.toBitmap();
        const i = (y * image.getSize().width + x) * 4;
        return [bgra[i + 2] ?? -1, bgra[i + 1] ?? -1, bgra[i] ?? -1];
      }
      return undefined;
    },
    [x, y] as const,
  );
}

/** Image-pixel position inside the editor canvas, in page coordinates. */
async function at(editor: Page, x: number, y: number): Promise<[number, number]> {
  const box = await editor.locator('#clip').boundingBox();
  if (!box) throw new Error('no canvas');
  const scale = box.width / FIXTURE.card.width;
  return [box.x + x * scale, box.y + y * scale];
}

async function drag(editor: Page, from: [number, number], to: [number, number]) {
  await editor.mouse.move(...(await at(editor, ...from)));
  await editor.mouse.down();
  await editor.mouse.move(...(await at(editor, ...to)), { steps: 5 });
  await editor.mouse.up();
}

async function historyIds(): Promise<string[]> {
  const index = await readFile(join(ctx.userData, 'history', 'index.json'), 'utf8').catch(
    () => '[]',
  );
  return (JSON.parse(index) as { id: string }[]).map((e) => e.id);
}

async function openFromHistory(): Promise<Page> {
  await dispatch(ctx.app, 'history');
  const history = await pageOf(ctx.app, 'history');
  const card = history.getByTestId('history-card').first();
  await card.hover();
  await card.getByRole('button', { name: 'Open in editor' }).click();
  const editor = await pageOf(ctx.app, 'editor');
  await expect(editor.getByTestId('editor-size')).toHaveText('300 × 200');
  await pressClosing(history, 'Escape');
  return editor;
}

test('edits saved to history reopen as editable annotations over the original', async () => {
  await pressClosing(await selectCard(ctx.app), 'e');
  const editor = await pageOf(ctx.app, 'editor');
  await editor.getByTestId('tool-rect').click();
  await editor.getByTestId('color').click();
  await editor.getByTitle('#ffcc00').click();
  await editor.getByRole('button', { name: 'Fill', exact: true }).click();
  await drag(editor, [20, 20], [80, 80]);
  await editor.getByTestId('editor-save').click();
  await expect(editor.getByTestId('editor-status')).toContainText('Saved to');
  await expect.poll(historyIds).toHaveLength(1);
  // Saving cleared the dirty state, so the editor closes without asking.
  await pressClosing(editor, 'Control+w');
  await expect.poll(() => windowKinds(ctx.app)).toEqual([]);

  const reopened = await openFromHistory();
  expect(near(await copiedPixel(reopened, 50, 50), YELLOW)).toBe(true);
  // The rectangle is an object: move it, and the original pixels show where it was.
  await reopened.getByTestId('tool-select').click();
  await drag(reopened, [50, 50], [150, 100]);
  expect(near(await copiedPixel(reopened, 50, 50), FIXTURE.card.rgb)).toBe(true);
  expect(near(await copiedPixel(reopened, 150, 100), YELLOW)).toBe(true);
  // Still selected after the move: delete it.
  await reopened.keyboard.press('Delete');
  expect(near(await copiedPixel(reopened, 150, 100), FIXTURE.card.rgb)).toBe(true);
  await reopened.keyboard.press('Control+z');
  expect(near(await copiedPixel(reopened, 150, 100), YELLOW)).toBe(true);
  // Copying saved the moved rectangle back into the same entry.
  expect(await historyIds()).toHaveLength(1);
  await pressClosing(reopened, 'Control+w');
  await expect.poll(() => windowKinds(ctx.app)).toEqual([]);

  const again = await openFromHistory();
  await again.getByTestId('tool-select').click();
  await again.mouse.click(...(await at(again, 150, 100)));
  await again.keyboard.press('Delete');
  expect(near(await copiedPixel(again, 150, 100), FIXTURE.card.rgb)).toBe(true);
});

test('history entries without a usable document open as plain images', async () => {
  const overlay = await selectCard(ctx.app);
  await overlay.getByTestId('tool-rect').click();
  await overlay.mouse.move(FIXTURE.card.x + 20, FIXTURE.card.y + 20);
  await overlay.mouse.down();
  await overlay.mouse.move(FIXTURE.card.x + 80, FIXTURE.card.y + 80, { steps: 4 });
  await overlay.mouse.up();
  await pressClosing(overlay, 'Control+c');
  await expect.poll(historyIds).toHaveLength(1);
  const [id] = await historyIds();
  // An annotated overlay capture keeps its document...
  const project = join(ctx.userData, 'history', `${id}.anyshot`);
  expect((await readFile(project)).subarray(0, 8).toString()).toBe('ANYSHOT1');
  // ...but a damaged one is ignored: the rendered image opens instead.
  await writeFile(project, 'ANYSHOT1 damaged');
  const editor = await openFromHistory();
  await editor.getByTestId('tool-select').click();
  await editor.mouse.click(...(await at(editor, 50, 50)));
  await editor.keyboard.press('Delete');
  await expect(editor.getByTestId('undo')).toBeDisabled();
  expect(ctx.mainLog.join('\n')).toContain('ignoring the malformed document');
});

test('the editor window keeps room for its whole toolbar, so Done is never cut off', async () => {
  await pressClosing(await selectCard(ctx.app), 'Control+s');
  await expect.poll(historyIds).toHaveLength(1);
  const editor = await openFromHistory();
  const done = editor.getByRole('button', { name: 'Done' });
  await expect(done).toBeVisible();
  const editorWindow = () =>
    ctx.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('/editor/'),
      );
      if (!win) throw new Error('no editor window');
      return { size: win.getSize(), min: win.getMinimumSize() };
    });
  // The header (title, zoom, save, Replace, pin, Done) and the tool strip each need
  // more than this; the window refuses to get that narrow.
  await ctx.app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows())
      if (w.webContents.getURL().includes('/editor/')) w.setSize(420, 300);
  });
  await expect.poll(async () => (await editorWindow()).min[0] ?? 0).toBeGreaterThan(420);
  const { size, min } = await editorWindow();
  expect(size[0]).toBeGreaterThanOrEqual(min[0] ?? 0);
  // Everything at the end of both rows is inside the page.
  const right = async (testId: string | null) => {
    const box = await (testId ? editor.getByTestId(testId) : done).boundingBox();
    return box ? box.x + box.width : Number.POSITIVE_INFINITY;
  };
  const pageWidth = await editor.evaluate(() => document.documentElement.clientWidth);
  expect(await right(null)).toBeLessThanOrEqual(pageWidth);
  expect(await right('fx-beautify')).toBeLessThanOrEqual(pageWidth);
  // The title gives way first, but stays readable.
  const title = await editor.locator('#top .title').boundingBox();
  expect(title?.width ?? 0).toBeGreaterThanOrEqual(79);

  // The Save options menu hangs below its button; opening it doesn't widen the minimum.
  await editor.getByTestId('save-menu-toggle').click();
  await expect(editor.getByTestId('save-menu')).toBeVisible();
  await editor.waitForTimeout(300);
  expect((await editorWindow()).min).toEqual(min);
  await editor.keyboard.press('Escape');
});
