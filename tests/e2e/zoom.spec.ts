import { expect, type Locator, type Page, test } from '@playwright/test';
import { FIXTURE, showFixture } from './fixture';
import {
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
  await ctx.app.evaluate(async () => {
    await globalThis.__anyshot?.patch({ capture: { showThumbnail: false } });
  });
  await showFixture(ctx.app);
});

test.afterEach(async () => {
  await verifyAndClose(ctx);
});

const percent = async (label: Locator) => Number((await label.textContent())?.replace('%', ''));

/** Holds the pointer on a button for `ms`, then releases it. */
async function hold(page: Page, button: Locator, ms: number): Promise<void> {
  const box = await button.boundingBox();
  if (!box) throw new Error('button not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test('editor zoom buttons step once per click and repeat while held', async () => {
  await pressClosing(await selectCard(ctx.app), 'e');
  const editor = await pageOf(ctx.app, 'editor');
  const level = editor.getByTestId('zoom-level');
  await expect(level).toHaveText('100%');

  await editor.getByTestId('zoom-in').click();
  await expect(level).toHaveText('125%');
  // Keyboard activation is one step too.
  await editor.getByTestId('zoom-out').focus();
  await editor.keyboard.press('Enter');
  await expect(level).toHaveText('100%');
  await editor.keyboard.press('Space');
  await expect(level).toHaveText('80%');

  await editor.getByTestId('zoom-level').click();
  await expect(level).toHaveText('100%');
  await hold(editor, editor.getByTestId('zoom-in'), 800);
  // Two or more steps: 1.25² = 156 %.
  await expect.poll(() => percent(level)).toBeGreaterThanOrEqual(156);
  const afterRelease = await percent(level);
  await editor.waitForTimeout(300);
  expect(await percent(level)).toBe(afterRelease);
});

test('pin zoom buttons repeat while held', async () => {
  await pressClosing(await selectCard(ctx.app), 'f');
  const pin = await pageOf(ctx.app, 'pin');
  await expect(pin.getByTestId('pin')).toBeVisible();
  const level = pin.getByTestId('pin-zoom');
  await pin.getByTestId('pin').hover();
  await pin.getByTestId('pin-zoom-in').click();
  await expect(level).toHaveText('125%');
  await level.click();
  await expect(level).toHaveText('100%');
  await hold(pin, pin.getByTestId('pin-zoom-in'), 800);
  await expect.poll(() => percent(level)).toBeGreaterThanOrEqual(156);
  await pressClosing(pin, 'Escape');
});

test('a pin zoomed out as far as it goes still shows all of its controls', async () => {
  await pressClosing(await selectCard(ctx.app), 'f');
  const pin = await pageOf(ctx.app, 'pin');
  await expect(pin.getByTestId('pin')).toBeVisible();
  const level = pin.getByTestId('pin-zoom');
  await pin.getByTestId('pin').hover();
  // Far more steps than it takes to reach the floor (300 px → 10 % would be 30 px).
  for (let i = 0; i < 15; i++) await pin.getByTestId('pin-zoom-out').click();
  const floor = await percent(level);
  expect(floor).toBeGreaterThan(10);
  await pin.getByTestId('pin-zoom-out').click();
  await expect(level).toHaveText(`${floor}%`);
  // Wait for the window to take its final size, then check every control fits.
  await expect
    .poll(() => pin.evaluate(() => window.innerWidth))
    .toBeLessThan(FIXTURE.card.width * 0.8);
  await pin.waitForTimeout(200);
  const viewport = await pin.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  for (const button of await pin.locator('.controls button').all()) {
    const box = await button.boundingBox();
    if (!box) throw new Error('control not rendered');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.w);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.h);
  }
  // Zooming in and resetting still work from the floor; Esc still closes.
  await pin.getByTestId('pin-zoom-in').click();
  await expect.poll(() => percent(level)).toBeGreaterThan(floor);
  await level.click();
  await expect(level).toHaveText('100%');
  await pressClosing(pin, 'Escape');
  await expect.poll(() => windowKinds(ctx.app)).toEqual([]);
});
