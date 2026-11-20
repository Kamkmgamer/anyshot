import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { parseDoc } from '../../src/engine/document';
import type { TextAnnotation } from '../../src/engine/model';
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

/** Captures the fixture card and opens it in the editor, unannotated. */
async function openEditor(): Promise<Page> {
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
  await pressClosing(overlay, 'e');
  const editor = await pageOf(ctx.app, 'editor');
  await expect(editor.getByTestId('editor-size')).toHaveText('300 × 200');
  return editor;
}

/** Saves the editor's project and returns its text annotations. Later saves go to the same file. */
async function savedTexts(editor: Page): Promise<TextAnnotation[]> {
  const file = join(ctx.userData, 'shot.anyshot');
  await rm(file, { force: true });
  await ctx.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: path,
    })) as typeof dialog.showSaveDialog;
  }, file);
  await editor.keyboard.press('Control+Shift+s');
  await expect
    .poll(() =>
      stat(file).then(
        (s) => s.size > 0,
        () => false,
      ),
    )
    .toBe(true);
  const project = unpackProject(new Uint8Array(await readFile(file)));
  return parseDoc(project?.doc).annotations.filter((a): a is TextAnnotation => a.kind === 'text');
}

/** RGBA of the image and annotation layers as shown on screen. */
async function screenPixels(editor: Page) {
  return editor.evaluate(() => {
    const base = document.querySelector('canvas.layer-base') as HTMLCanvasElement;
    const committed = document.querySelector('canvas.layer-committed') as HTMLCanvasElement;
    const out = new OffscreenCanvas(base.width, base.height);
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('no 2D context');
    ctx.drawImage(base, 0, 0);
    ctx.drawImage(committed, 0, 0);
    return {
      width: base.width,
      height: base.height,
      rgba: Array.from(ctx.getImageData(0, 0, base.width, base.height).data),
    };
  });
}

/** BGRA of the image on the clipboard. */
async function clipboardPixels() {
  return ctx.app.evaluate(async ({ clipboard, nativeImage }) => {
    for (const item of await clipboard.read()) {
      if (!item.types.includes('image/png')) continue;
      const blob = (await item.getType('image/png')) as Blob;
      const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
      return { ...image.getSize(), bgra: Array.from(image.toBitmap()) };
    }
    return null;
  });
}

test('the text style popover restyles text live, and the canvas matches the export', async () => {
  const editor = await openEditor();
  const clip = await editor.locator('#clip').boundingBox();
  if (!clip) throw new Error('no canvas');
  await editor.getByTestId('tool-text').click();

  // Opening the popover and pressing on the image only closes it: no text box opens.
  await editor.getByTestId('text-style').click();
  const popover = editor.getByTestId('text-popover');
  await expect(popover).toBeVisible();
  await editor.mouse.click(clip.x + 150, clip.y + 150);
  await expect(popover).toHaveCount(0);
  await expect(editor.locator('.text-editor')).toHaveCount(0);

  // Type, then restyle from the popover: the box stays open and focused, and shows the style.
  await editor.mouse.click(clip.x + 16, clip.y + 60);
  const box = editor.locator('.text-editor');
  await expect(box).toBeFocused();
  await editor.keyboard.type('Styled');
  await editor.getByTestId('text-style').click();
  await popover.getByTestId('text-font-serif').click();
  await popover.getByTestId('text-italic').click();
  await popover.getByTestId('text-underline').click();
  // The box previews the outline the canvas draws, until it is turned off.
  const shadow = () => box.evaluate((el) => getComputedStyle(el).textShadow);
  expect(await shadow()).toContain('rgba(255, 255, 255, 0.85)');
  await popover.getByTestId('text-outline').click();
  await expect.poll(shadow).toBe('none');
  await popover.getByTestId('text-size-up').click();
  await popover.getByTestId('text-size-up').click();
  await expect(popover.getByTestId('text-size')).toHaveText('36');
  await popover.getByRole('button', { name: '#ffffff' }).click();
  await expect(popover.getByTestId('text-italic')).toHaveAttribute('aria-pressed', 'true');
  await expect(box).toBeFocused();
  const css = await box.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      family: s.fontFamily,
      style: s.fontStyle,
      size: s.fontSize,
      line: s.textDecorationLine,
      color: s.color,
    };
  });
  expect(css).toMatchObject({
    style: 'italic',
    size: '36px',
    line: 'underline',
    color: 'rgb(255, 255, 255)',
  });
  expect(css.family).toMatch(/^Georgia/);
  await editor.keyboard.type(' text');
  await editor.keyboard.press('Enter');
  await expect(box).toHaveCount(0);
  await editor.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);

  const [text] = await savedTexts(editor);
  expect(text).toMatchObject({
    text: 'Styled text',
    size: 36,
    color: '#ffffff',
    style: { font: 'serif', bold: true, italic: true, underline: true, outline: false },
  });

  // The choices are remembered for the next text.
  await expect
    .poll(async () => {
      const tools = JSON.parse(await readFile(join(ctx.userData, 'settings.json'), 'utf8')).tools;
      return [tools?.textFont, tools?.textItalic, tools?.textUnderline, tools?.textOutline];
    })
    .toEqual(['serif', true, true, false]);

  // What the canvas shows is what is exported, pixel for pixel (within rounding).
  await ctx.app.evaluate(({ clipboard }) => clipboard.clear());
  await editor.keyboard.press('Control+c');
  await expect.poll(async () => (await clipboardPixels())?.width).toBe(300);
  const exported = await clipboardPixels();
  const shown = await screenPixels(editor);
  expect({ width: shown.width, height: shown.height }).toEqual({ width: 300, height: 200 });
  let differing = 0;
  let white = 0;
  for (let i = 0; i < shown.rgba.length; i += 4) {
    const [r, g, b] = [shown.rgba[i] ?? 0, shown.rgba[i + 1] ?? 0, shown.rgba[i + 2] ?? 0];
    const [eb, eg, er] = [
      exported?.bgra[i] ?? 0,
      exported?.bgra[i + 1] ?? 0,
      exported?.bgra[i + 2] ?? 0,
    ];
    if (Math.max(Math.abs(r - er), Math.abs(g - eg), Math.abs(b - eb)) > 8) differing++;
    if (r > 240 && g > 240 && b > 240) white++;
  }
  // The white text is there (on the red card), and both renderings agree.
  expect(white).toBeGreaterThan(300);
  expect(differing).toBe(0);
});

test('the style popover restyles selected text', async () => {
  const editor = await openEditor();
  const clip = await editor.locator('#clip').boundingBox();
  if (!clip) throw new Error('no canvas');
  await editor.getByTestId('tool-text').click();
  await editor.mouse.click(clip.x + 16, clip.y + 60);
  await editor.keyboard.type('Plain');
  await editor.keyboard.press('Enter');

  // Select it: the options row offers the text style for the selection.
  await editor.getByTestId('tool-select').click();
  await expect(editor.getByTestId('text-style')).toHaveCount(0);
  await editor.mouse.click(clip.x + 30, clip.y + 50);
  await editor.getByTestId('text-style').click();
  const popover = editor.getByTestId('text-popover');
  await popover.getByTestId('text-bold').click();
  await popover.getByTestId('text-font-mono').click();
  // A press outside closes it.
  await editor.mouse.click(clip.x + 280, clip.y + 190);
  await expect(popover).toHaveCount(0);

  const [text] = await savedTexts(editor);
  expect(text).toMatchObject({ text: 'Plain', style: { font: 'mono', bold: false } });
  await editor.keyboard.press('Control+z');
  await editor.keyboard.press('Control+z');
  // Each change was one undo step.
  const [undone] = await savedTexts(editor);
  expect(undone?.style).toMatchObject({ font: 'sans', bold: true });
});

test('overlay popovers open upwards when there is no room below the toolbar', async () => {
  await dispatch(ctx.app, 'captureArea');
  const overlay = await pageOf(ctx.app, 'overlay');
  await expect
    .poll(() =>
      ctx.app.evaluate(() =>
        globalThis.__anyshot?.windows().some((w) => w.kind === 'overlay' && w.visible),
      ),
    )
    .toBe(true);
  // The toolbar fits below this selection, but a popover under it would not.
  await overlay.mouse.move(300, 300);
  await overlay.mouse.down();
  await overlay.mouse.move(900, 600, { steps: 5 });
  await overlay.mouse.up();
  await overlay.getByTestId('tool-text').click();
  const screen = overlay.viewportSize() ?? { width: 1280, height: 800 };
  const tools = await overlay.getByTestId('tools').boundingBox();
  expect(tools?.y).toBeGreaterThan(600);
  for (const [button, testId] of [
    ['text-style', 'text-popover'],
    ['fx-beautify', 'beautify-popover'],
  ] as const) {
    await overlay.getByTestId(button).click();
    const box = await overlay.getByTestId(testId).boundingBox();
    if (!box) throw new Error(`no ${testId}`);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(screen.height);
    expect(box.y + box.height).toBeLessThanOrEqual(tools?.y ?? 0);
    await overlay.keyboard.press('Escape');
  }
  await pressClosing(overlay, 'Escape');
});

test('with the select tool the popover shows and toggles the style of the selected text', async () => {
  const editor = await openEditor();
  const clip = await editor.locator('#clip').boundingBox();
  if (!clip) throw new Error('no canvas');
  await editor.getByTestId('tool-text').click();
  const popover = editor.getByTestId('text-popover');
  // Italic text, then italic turned off for the next text.
  await editor.getByTestId('text-style').click();
  await popover.getByTestId('text-italic').click();
  await editor.keyboard.press('Escape');
  await editor.mouse.click(clip.x + 16, clip.y + 60);
  await editor.keyboard.type('Leaning');
  await editor.keyboard.press('Enter');
  await editor.getByTestId('text-style').click();
  await popover.getByTestId('text-italic').click();
  await expect(popover.getByTestId('text-italic')).toHaveAttribute('aria-pressed', 'false');
  await editor.keyboard.press('Escape');

  await editor.getByTestId('tool-select').click();
  await editor.mouse.click(clip.x + 30, clip.y + 50);
  await editor.getByTestId('text-style').click();
  // It shows the selection's italic, not the remembered upright style; one click turns it off.
  await expect(popover.getByTestId('text-italic')).toHaveAttribute('aria-pressed', 'true');
  await popover.getByTestId('text-italic').click();
  await expect(popover.getByTestId('text-italic')).toHaveAttribute('aria-pressed', 'false');
  await editor.keyboard.press('Escape');
  const [text] = await savedTexts(editor);
  expect(text).toMatchObject({ text: 'Leaning', style: { italic: false } });
});
