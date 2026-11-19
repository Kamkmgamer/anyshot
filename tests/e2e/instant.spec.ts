import { expect, test } from '@playwright/test';
import { showFixture } from './fixture';
import {
  dispatch,
  type Launched,
  launch,
  pageOf,
  pressClosing,
  processTypes,
  rendererCount,
} from './harness';

let ctx: Launched;

test.beforeEach(async () => {
  ctx = await launch([], { capture: { instantCapture: true, showThumbnail: false } });
});

test.afterEach(async () => {
  expect(ctx.errors).toEqual([]);
  await ctx.close();
});

const overlays = () =>
  ctx.app.evaluate(() => globalThis.__anyshot?.windows().filter((w) => w.kind === 'overlay') ?? []);

test('instant capture keeps one hidden overlay ready and reuses it', async () => {
  // Idle with instant capture: exactly one hidden overlay renderer.
  await expect.poll(async () => (await overlays()).map((w) => w.visible)).toEqual([false]);
  await expect.poll(async () => rendererCount(await processTypes(ctx.app))).toBe(1);
  await showFixture(ctx.app);
  for (let i = 0; i < 3; i++) {
    await expect.poll(async () => (await overlays()).length).toBe(1);
    await dispatch(ctx.app, 'captureArea');
    await expect.poll(async () => (await overlays()).some((w) => w.visible)).toBe(true);
    const page = await pageOf(ctx.app, 'overlay');
    await pressClosing(page, 'Escape');
    // A fresh warm overlay replaces the used one.
    await expect
      .poll(async () => (await overlays()).map((w) => w.visible), { timeout: 10_000 })
      .toEqual([false]);
  }
  const timings = await ctx.app.evaluate(() => globalThis.__anyshot?.timings.hotkeyToOverlay ?? []);
  console.log(
    'hotkey → overlay ms (instant capture, Xvfb):',
    timings.map((t) => Math.round(t)).join(', '),
  );
  expect(timings).toHaveLength(3);
});
