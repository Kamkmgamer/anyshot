import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { showFixture } from './fixture';
import { dispatch, launch, pageOf, pressClosing, verifyAndClose } from './harness';

// Regenerates docs/screenshots. Run with ANYSHOT_SCREENSHOTS=1.
test.skip(
  process.env.ANYSHOT_SCREENSHOTS !== '1',
  'set ANYSHOT_SCREENSHOTS=1 to update docs screenshots',
);

const out = (name: string) => join(import.meta.dirname, '../../docs/screenshots', name);

test('overlay and editor screenshots', async () => {
  const ctx = await launch();
  try {
    await ctx.app.evaluate(async () => {
      await globalThis.__anyshot?.patch({
        capture: { showThumbnail: false },
        tools: { color: '#ff3b30' },
      });
    });
    await showFixture(ctx.app);
    await dispatch(ctx.app, 'captureArea');
    const overlay = await pageOf(ctx.app, 'overlay');
    await expect
      .poll(() =>
        ctx.app.evaluate(() =>
          globalThis.__anyshot?.windows().some((w) => w.kind === 'overlay' && w.visible),
        ),
      )
      .toBe(true);
    const drag = async (a: [number, number], b: [number, number]) => {
      await overlay.mouse.move(...a);
      await overlay.mouse.down();
      await overlay.mouse.move(...b, { steps: 6 });
      await overlay.mouse.up();
    };
    // Select the report window, then annotate it.
    await drag([500, 100], [1100, 520]);
    await overlay.getByTestId('tool-arrow').click();
    await drag([700, 440], [745, 330]);
    await overlay.getByTestId('tool-rect').click();
    await drag([538, 284], [772, 326]);
    await overlay.getByTestId('tool-number').click();
    await overlay.mouse.click(1030, 180);
    await overlay.getByTestId('tool-text').click();
    await overlay.mouse.click(770, 455);
    await overlay.keyboard.type('Big quarter!');
    await overlay.keyboard.press('Enter');
    await overlay.getByTestId('tool-marker').click();
    await drag([548, 233], [800, 233]);
    await overlay.getByTestId('tool-arrow').click();
    await overlay.waitForTimeout(300);
    await overlay.screenshot({ path: out('overlay.png') });

    await pressClosing(overlay, 'e');
    const editor = await pageOf(ctx.app, 'editor');
    await expect(editor.getByTestId('editor-size')).toHaveText('600 × 420');
    await ctx.app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows())
        if (w.webContents.getURL().includes('/editor/')) w.setSize(1100, 720);
    });
    await editor.waitForTimeout(500);
    await editor.keyboard.press('Control+1');
    await editor.getByTestId('tool-censor').click();
    const box = await editor.locator('#clip').boundingBox();
    if (!box) throw new Error('no canvas');
    const s = box.width / 600;
    await editor.mouse.move(box.x + 40 * s, box.y + 155 * s);
    await editor.mouse.down();
    await editor.mouse.move(box.x + 420 * s, box.y + 180 * s, { steps: 4 });
    await editor.mouse.up();
    await editor.waitForTimeout(300);
    await editor.screenshot({ path: out('editor.png') });
  } finally {
    await verifyAndClose(ctx);
  }
});

test('settings appearance screenshots', async () => {
  const ctx = await launch();
  try {
    await dispatch(ctx.app, 'settings');
    const page = await pageOf(ctx.app, 'settings');
    const theme = page.getByRole('radiogroup', { name: 'Appearance' });
    for (const name of ['Light', 'Dark'] as const) {
      await theme.getByRole('radio', { name }).click();
      await expect(theme.getByRole('radio', { name })).toBeChecked();
      await theme.getByRole('radio', { name }).focus();
      await page.waitForTimeout(200);
      await page.screenshot({ path: out(`settings-theme-${name.toLowerCase()}.png`) });
    }
  } finally {
    await verifyAndClose(ctx);
  }
});

test('settings tools reset screenshot', async () => {
  const ctx = await launch();
  try {
    await dispatch(ctx.app, 'settings');
    const page = await pageOf(ctx.app, 'settings');
    await page.getByTestId('tab-tools').click();
    await page.getByRole('checkbox', { name: 'Spotlight', exact: true }).uncheck();
    await page.getByRole('checkbox', { name: 'Stamp', exact: true }).uncheck();
    await page.getByTestId('reset-tools').click();
    await expect(page.getByTestId('reset-tools-confirm')).toBeVisible();
    await page.waitForTimeout(200);
    await page.screenshot({ path: out('settings-tools-reset.png') });
  } finally {
    await verifyAndClose(ctx);
  }
});
