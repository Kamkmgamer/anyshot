import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { FIXTURE, showFixture } from './fixture';
import { dispatch, launch, pageOf, pressClosing, verifyAndClose, windowKinds } from './harness';

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

    // Beautify: the frame shows live around the image while a background is picked.
    await editor.getByTestId('fx-beautify').click();
    await editor
      .getByTestId('beautify-popover')
      .getByRole('button', { name: 'Background 1' })
      .click();
    await expect(editor.locator('#frame')).toHaveClass(/beautified/);
    await editor.keyboard.press('Control+0');
    await editor.waitForTimeout(400);
    await editor.screenshot({ path: out('editor-beautify.png') });
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

test('about, instant preview setting and thumbnail screenshots', async () => {
  const ctx = await launch([], { capture: { instantPreview: false, thumbnailDismissSeconds: 0 } });
  try {
    await dispatch(ctx.app, 'settings');
    const page = await pageOf(ctx.app, 'settings');
    await page.getByTestId('tab-about').click();
    await expect
      .poll(() =>
        page.locator('.about .logo').evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBe(256);
    await page.screenshot({ path: out('settings-about.png') });
    await page.getByTestId('tab-capture').click();
    await expect(page.getByTestId('instant-preview')).toBeVisible();
    await page.waitForTimeout(200);
    await page.screenshot({ path: out('settings-instant-preview.png') });
    await pressClosing(page, 'Escape');

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
    const { card } = FIXTURE;
    await overlay.mouse.move(card.x, card.y);
    await overlay.mouse.down();
    await overlay.mouse.move(card.x + card.width, card.y + card.height, { steps: 5 });
    await overlay.mouse.up();
    const floating = await pageOf(ctx.app, 'floating');
    await floating.getByTestId('floating-card').hover();
    await expect(floating.getByTestId('floating-edit')).toBeVisible();
    await floating.waitForTimeout(300);
    await floating.screenshot({ path: out('floating-thumbnail.png') });
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

test('history preview, split save and measure screenshots', async () => {
  const ctx = await launch();
  try {
    await ctx.app.evaluate(
      async (_e, dir) => {
        await globalThis.__anyshot?.patch({
          capture: { showThumbnail: false },
          output: { saveDir: dir },
          tools: { color: '#ff3b30' },
        });
      },
      join(ctx.userData, 'shots'),
    );
    await showFixture(ctx.app);
    const select = async (a: [number, number], b: [number, number]) => {
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
      await overlay.mouse.move(...a);
      await overlay.mouse.down();
      await overlay.mouse.move(...b, { steps: 6 });
      await overlay.mouse.up();
      return overlay;
    };
    const drag = async (page: Page, a: [number, number], b: [number, number]) => {
      await page.mouse.move(...a);
      await page.mouse.down();
      await page.mouse.move(...b, { steps: 6 });
      await page.mouse.up();
    };

    // Measure: dragged from inside the report to far outside the selection.
    const measured = await select([540, 160], [1060, 470]);
    await measured.getByTestId('tool-measure').click();
    await drag(measured, [600, 300], [1200, 300]);
    await measured.mouse.move(1200, 300);
    await measured.waitForTimeout(300);
    await measured.screenshot({ path: out('measure-clamped.png') });
    await pressClosing(measured, 'Control+c');

    // Two more captures, annotated, for the history window.
    const card = await select([100, 100], [400, 300]);
    await card.getByTestId('tool-arrow').click();
    await drag(card, [150, 260], [300, 160]);
    await pressClosing(card, 'Control+c');
    const report = await select([520, 120], [1080, 500]);
    await report.getByTestId('tool-rect').click();
    await drag(report, [538, 284], [772, 326]);
    await pressClosing(report, 'Control+c');

    await dispatch(ctx.app, 'history');
    const history = await pageOf(ctx.app, 'history');
    await ctx.app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows())
        if (w.webContents.getURL().includes('/history/')) w.setSize(960, 640);
    });
    await expect(history.getByTestId('history-card')).toHaveCount(3);
    await history.getByTestId('history-card').first().click();
    await expect
      .poll(() =>
        history
          .getByTestId('preview-image')
          .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
    await history.waitForTimeout(300);
    await history.screenshot({ path: out('history-preview.png') });

    // Edit it: the editor offers Replace original / Save as copy.
    await history.getByTestId('preview-edit').click();
    const editor = await pageOf(ctx.app, 'editor');
    await pressClosing(history, 'Escape');
    await ctx.app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows())
        if (w.webContents.getURL().includes('/editor/')) w.setSize(1100, 720);
    });
    await editor.waitForTimeout(400);
    await editor.keyboard.press('Control+1');
    await editor.getByTestId('save-menu-toggle').click();
    await expect(editor.getByTestId('save-menu')).toBeVisible();
    await editor.waitForTimeout(200);
    await editor.screenshot({ path: out('editor-save-menu.png') });
    await editor.keyboard.press('Escape');
  } finally {
    await verifyAndClose(ctx);
  }
});

test('record bar audio toggles screenshot', async () => {
  const ctx = await launch();
  try {
    await showFixture(ctx.app);
    await dispatch(ctx.app, 'recordArea');
    const overlay = await pageOf(ctx.app, 'overlay');
    await expect
      .poll(() =>
        ctx.app.evaluate(() =>
          globalThis.__anyshot?.windows().some((w) => w.kind === 'overlay' && w.visible),
        ),
      )
      .toBe(true);
    await overlay.mouse.move(300, 150);
    await overlay.mouse.down();
    await overlay.mouse.move(900, 550, { steps: 4 });
    await overlay.mouse.up();
    await overlay.getByTestId('audio-mic').click();
    await overlay.mouse.move(1000, 700);
    await overlay.waitForTimeout(300);
    await overlay.screenshot({
      path: out('record-audio.png'),
      clip: { x: 250, y: 100, width: 760, height: 520 },
    });
    await pressClosing(overlay, 'Escape');
  } finally {
    await verifyAndClose(ctx);
  }
});

test('text style popover screenshot', async () => {
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
    await overlay.mouse.move(500, 100);
    await overlay.mouse.down();
    await overlay.mouse.move(1100, 520, { steps: 6 });
    await overlay.mouse.up();
    await overlay.getByTestId('tool-text').click();
    // A placed text in the default style, then a styled one being typed.
    await overlay.mouse.click(560, 300);
    await overlay.keyboard.type('Default style');
    await overlay.keyboard.press('Enter');
    await overlay.mouse.click(560, 400);
    await overlay.keyboard.type('Serif, italic, underlined');
    await overlay.getByTestId('text-style').click();
    const popover = overlay.getByTestId('text-popover');
    await popover.getByTestId('text-font-serif').click();
    await popover.getByTestId('text-italic').click();
    await popover.getByTestId('text-underline').click();
    await popover.getByRole('button', { name: '#007aff' }).click();
    await overlay.waitForTimeout(300);
    await overlay.screenshot({ path: out('text-style.png') });
  } finally {
    await verifyAndClose(ctx);
  }
});

test('update window screenshot', async () => {
  const ctx = await launch();
  try {
    await ctx.app.evaluate(() =>
      globalThis.__anyshot?.offerUpdate({
        version: '0.3.0',
        current: '0.1.2',
        notes: [
          'Scroll capture: keep track while scrolling slowly, at any scaling',
          'Close popovers on a click outside them and on Esc',
          'Text tool styles: font, bold, italic, underline, outline, size, colour',
        ],
        releaseUrl: 'https://github.com/mgamergo/anyshot/releases/tag/v0.3.0',
        canInstall: true,
      }),
    );
    const page = await pageOf(ctx.app, 'update');
    await expect(page.getByTestId('update-notes')).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: out('update.png') });
  } finally {
    await verifyAndClose(ctx);
  }
});

test('beautify, colour picker toast and narrow editor screenshots', async () => {
  const ctx = await launch();
  try {
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
    await dispatch(ctx.app, 'captureArea');
    const overlay = await pageOf(ctx.app, 'overlay');
    await expect
      .poll(() =>
        ctx.app.evaluate(() =>
          globalThis.__anyshot?.windows().some((w) => w.kind === 'overlay' && w.visible),
        ),
      )
      .toBe(true);
    await overlay.mouse.move(520, 120);
    await overlay.mouse.down();
    await overlay.mouse.move(1080, 500, { steps: 6 });
    await overlay.mouse.up();
    await pressClosing(overlay, 'Control+s');
    await expect.poll(() => windowKinds(ctx.app)).toEqual([]);

    // Edited from history, so the header has Replace and Done too: its widest form.
    await dispatch(ctx.app, 'history');
    const history = await pageOf(ctx.app, 'history');
    const card = history.getByTestId('history-card').first();
    await card.hover();
    await card.getByRole('button', { name: 'Open in editor' }).click();
    const editor = await pageOf(ctx.app, 'editor');
    await pressClosing(history, 'Escape');
    const resize = (width: number, height: number) =>
      ctx.app.evaluate(
        ({ BrowserWindow }, [width, height]) => {
          for (const w of BrowserWindow.getAllWindows())
            if (w.webContents.getURL().includes('/editor/')) w.setSize(width, height);
        },
        [width, height] as const,
      );
    await resize(1100, 720);
    await editor.waitForTimeout(400);
    await editor.keyboard.press('Control+1');

    // Beautify while off: "No background" is chosen and the sliders wait for a background.
    await editor.getByTestId('fx-beautify').click();
    const popover = editor.getByTestId('beautify-popover');
    await editor.waitForTimeout(200);
    await editor.screenshot({ path: out('beautify-off.png') });
    await popover.getByRole('button', { name: 'Background 4' }).click();
    await expect(editor.locator('#frame')).toHaveClass(/beautified/);
    await editor.waitForTimeout(300);
    await editor.screenshot({ path: out('beautify-on.png') });
    await popover.getByTestId('beautify-none').click();
    await editor.keyboard.press('Escape');

    // The colour picker says what it did.
    await editor.getByTestId('tool-picker').click();
    const chip = await editor.locator('#clip').boundingBox();
    if (!chip) throw new Error('no canvas');
    await editor.mouse.click(chip.x + chip.width * 0.12, chip.y + chip.height * 0.88);
    await expect(editor.getByTestId('editor-status')).toContainText('Colour set to');
    await editor.waitForTimeout(150);
    await editor.screenshot({ path: out('picker-toast.png') });

    // Asked to be far narrower, the window stops where the whole toolbar still fits.
    await resize(420, 640);
    await editor.waitForTimeout(500);
    await editor.screenshot({ path: out('editor-narrow.png') });
  } finally {
    await verifyAndClose(ctx);
  }
});
