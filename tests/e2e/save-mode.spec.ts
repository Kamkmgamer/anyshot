import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { unpackProject } from '../../src/shared/project';
import { FIXTURE, showFixture } from './fixture';
import {
  dispatch,
  type Launched,
  launch,
  pageOf,
  pressClosing,
  selectCard,
  verifyAndClose,
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

const historyFile = (name: string) => join(ctx.userData, 'history', name);

async function historyIds(): Promise<string[]> {
  const index = await readFile(historyFile('index.json'), 'utf8').catch(() => '[]');
  return (JSON.parse(index) as { id: string }[]).map((e) => e.id);
}

async function annotationCount(id: string): Promise<number> {
  const { doc } = unpackProject(await readFile(historyFile(`${id}.anyshot`)));
  return (doc as { annotations: unknown[] }).annotations.length;
}

/** An annotated capture in history, reopened in the editor from the History window. */
async function editHistoryCapture(): Promise<{ editor: Page; original: string }> {
  const overlay = await selectCard(ctx.app);
  await overlay.getByTestId('tool-rect').click();
  await overlay.mouse.move(FIXTURE.card.x + 20, FIXTURE.card.y + 20);
  await overlay.mouse.down();
  await overlay.mouse.move(FIXTURE.card.x + 80, FIXTURE.card.y + 80, { steps: 4 });
  await overlay.mouse.up();
  await pressClosing(overlay, 'Control+c');
  await expect.poll(historyIds).toHaveLength(1);
  const [original = ''] = await historyIds();
  await dispatch(ctx.app, 'history');
  const history = await pageOf(ctx.app, 'history');
  const card = history.getByTestId('history-card').first();
  await card.hover();
  await card.getByRole('button', { name: 'Open in editor' }).click();
  const editor = await pageOf(ctx.app, 'editor');
  await pressClosing(history, 'Escape');
  await expect(editor.getByTestId('editor-size')).toHaveText('300 × 200');
  // A second rectangle, so the edit is visible in the document.
  await editor.getByTestId('tool-rect').click();
  const box = await editor.locator('#clip').boundingBox();
  if (!box) throw new Error('no canvas');
  const s = box.width / 300;
  await editor.mouse.move(box.x + 150 * s, box.y + 100 * s);
  await editor.mouse.down();
  await editor.mouse.move(box.x + 250 * s, box.y + 180 * s, { steps: 4 });
  await editor.mouse.up();
  return { editor, original };
}

test('Save replaces the original entry by default', async () => {
  const { editor, original } = await editHistoryCapture();
  const before = await readFile(historyFile(`${original}.png`));
  await expect(editor.getByTestId('editor-save')).toHaveText('Replace');
  await editor.getByTestId('editor-save').click();
  await expect(editor.getByTestId('editor-status')).toContainText('Saved to');
  expect(await historyIds()).toEqual([original]);
  expect(await annotationCount(original)).toBe(2);
  expect((await readFile(historyFile(`${original}.png`))).equals(before)).toBe(false);
});

test('Save as copy adds an entry, leaves the original alone and is remembered', async () => {
  const { editor, original } = await editHistoryCapture();
  const before = await readFile(historyFile(`${original}.anyshot`));
  // Keyboard: the chevron opens the menu, arrows move, Enter picks.
  const toggle = editor.getByTestId('save-menu-toggle');
  await toggle.focus();
  await editor.keyboard.press('ArrowDown');
  const menu = editor.getByRole('menu', { name: 'Save options' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: /Replace original/ })).toBeFocused();
  await expect(menu.getByRole('menuitemradio', { name: /Save as copy/ })).toContainText(
    'Ctrl+Alt+S',
  );
  await editor.keyboard.press('ArrowDown');
  await editor.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(editor.getByTestId('editor-status')).toContainText('Saved a copy to');
  await expect.poll(historyIds).toHaveLength(2);
  const [copy = ''] = (await historyIds()).filter((id) => id !== original);
  expect(await annotationCount(copy)).toBe(2);
  expect((await readFile(historyFile(`${original}.anyshot`))).equals(before)).toBe(true);
  expect(await annotationCount(original)).toBe(1);

  // The choice is remembered and becomes the primary action.
  await expect(editor.getByTestId('editor-save')).toHaveText('Save copy');
  await expect
    .poll(async () => {
      const settings = await readFile(join(ctx.userData, 'settings.json'), 'utf8');
      return JSON.parse(settings).editor?.saveMode;
    })
    .toBe('copy');

  // The editor now works on the copy: Ctrl+Alt+S (the other choice) replaces it.
  await editor.getByTestId('editor-status').click();
  await editor.keyboard.press('Control+z');
  await editor.keyboard.press('Control+Alt+s');
  await expect(editor.getByTestId('editor-status')).toContainText('Saved to');
  expect(await historyIds()).toHaveLength(2);
  expect(await annotationCount(copy)).toBe(1);
  expect((await readFile(historyFile(`${original}.anyshot`))).equals(before)).toBe(true);
});

test('the save menu closes on Esc and on a click elsewhere', async () => {
  const { editor } = await editHistoryCapture();
  const toggle = editor.getByTestId('save-menu-toggle');
  const menu = editor.getByTestId('save-menu');
  await toggle.click();
  await expect(menu).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await editor.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await toggle.click();
  await expect(menu).toBeVisible();
  await editor.getByTestId('editor-size').click();
  await expect(menu).toHaveCount(0);
  expect(await historyIds()).toHaveLength(1);
});

test('captures without a history entry keep the plain Save button', async () => {
  await pressClosing(await selectCard(ctx.app), 'e');
  const editor = await pageOf(ctx.app, 'editor');
  await expect(editor.getByTestId('editor-save')).toBeVisible();
  await expect(editor.getByTestId('save-menu-toggle')).toHaveCount(0);
});
