import { expect, test } from '@playwright/test';
import { dispatch, type Launched, launch, pageOf, windowKinds } from './harness';

let ctx: Launched;

// A long, varied page: numbered rows with text-like bars, so overlap is unambiguous.
const rows = Array.from({ length: 80 }, (_, i) => {
  const w = 120 + ((i * 53) % 260);
  return `<div class="r"><b>Row ${i + 1}</b><i style="width:${w}px;background:hsl(${(i * 47) % 360} 60% 45%)"></i></div>`;
}).join('');
const html = `<!doctype html><meta charset="utf-8"><title>long page</title>
<style>body{margin:0;font:16px system-ui;background:#fff;color:#111}.r{display:flex;align-items:center;gap:14px;height:34px;padding:0 16px;border-bottom:1px solid #e5e7eb}i{display:block;height:12px;border-radius:6px}</style>${rows}`;

test.beforeEach(async () => {
  ctx = await launch();
  await ctx.app.evaluate(async () => {
    await globalThis.__anyshot?.patch({ capture: { showThumbnail: false, quickAction: 'copy' } });
  });
  await ctx.app.evaluate(async ({ BrowserWindow }, html) => {
    const win = new BrowserWindow({
      x: 0,
      y: 0,
      width: 1280,
      height: 800,
      frame: false,
      show: false,
    });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    win.show();
    await new Promise((r) => setTimeout(r, 300));
  }, html);
});

test.afterEach(async () => {
  expect(ctx.errors).toEqual([]);
  await ctx.close();
});

test('scroll capture stitches frames into one tall image', async () => {
  await dispatch(ctx.app, 'scrollCapture');
  const overlay = await pageOf(ctx.app, 'overlay');
  await expect
    .poll(() =>
      ctx.app.evaluate(() =>
        globalThis.__anyshot?.windows().some((w) => w.kind === 'overlay' && w.visible),
      ),
    )
    .toBe(true);
  await overlay.mouse.move(0, 0);
  await overlay.mouse.down();
  await overlay.mouse.move(600, 400, { steps: 4 });
  await overlay.mouse.up();
  await overlay
    .getByTestId('start')
    .click()
    .catch(() => {});
  const hud = await pageOf(ctx.app, 'scroll');
  await expect(hud.getByTestId('scroll-status')).toContainText('600 × 400', { timeout: 10_000 });
  for (let i = 0; i < 6; i++) {
    await ctx.app.evaluate(({ BrowserWindow }) => {
      const page = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().startsWith('data:'),
      );
      return page?.webContents.executeJavaScript('window.scrollBy(0, 110)');
    });
    await new Promise((r) => setTimeout(r, 450));
  }
  await expect(hud.getByTestId('scroll-status')).toContainText('600 × 1060');
  await hud
    .getByTestId('scroll-stop')
    .click()
    .catch(() => {});
  await expect.poll(() => windowKinds(ctx.app), { timeout: 15_000 }).toEqual([]);
  const size = await ctx.app.evaluate(async ({ clipboard, nativeImage }) => {
    for (const item of await clipboard.read()) {
      if (!item.types.includes('image/png')) continue;
      const blob = (await item.getType('image/png')) as Blob;
      return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).getSize();
    }
    return null;
  });
  expect(size).toEqual({ width: 600, height: 1060 });
});
