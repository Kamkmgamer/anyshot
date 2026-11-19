import { expect, test } from '@playwright/test';
import { showFixture } from './fixture';
import { dispatch, type Launched, launch, pageOf, processTypes, verifyAndClose } from './harness';

let ctx: Launched;

test.beforeEach(async () => {
  ctx = await launch([], undefined, { ANYSHOT_OCR_IDLE_MS: '2000' });
  await ctx.app.evaluate(async () => {
    await globalThis.__anyshot?.patch({ capture: { ocrAction: 'copy', showThumbnail: false } });
  });
  await showFixture(ctx.app);
});

test.afterEach(async () => {
  const info = test.info();
  if (ctx && info.status !== info.expectedStatus) console.log(ctx.mainLog.join('\n'));
  await verifyAndClose(ctx);
});

test('OCR capture copies the text and the OCR process exits when idle', async () => {
  await ctx.app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await dispatch(ctx.app, 'captureOcr');
  const overlay = await pageOf(ctx.app, 'overlay');
  await expect
    .poll(() =>
      ctx.app.evaluate(() =>
        globalThis.__anyshot?.windows().some((w) => w.kind === 'overlay' && w.visible),
      ),
    )
    .toBe(true);
  await overlay.mouse.move(530, 165);
  await overlay.mouse.down();
  await overlay.mouse.move(1075, 285, { steps: 4 });
  await overlay.mouse.up().catch(() => {});
  await expect
    .poll(() => ctx.app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 30_000 })
    .toContain('Quarterly report');
  const text = await ctx.app.evaluate(({ clipboard }) => clipboard.readText());
  expect(text).toMatch(/Revenue grew 18%/);
  // The OCR utility process exits after the idle timeout; only the network service remains.
  await expect
    .poll(async () => (await processTypes(ctx.app)).filter((t) => t === 'Utility').length, {
      timeout: 15_000,
    })
    .toBe(1);
});
