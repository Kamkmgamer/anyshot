import { execFileSync } from 'node:child_process';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { dispatch, type Launched, launch, pageOf, verifyAndClose, windowKinds } from './harness';

let ctx: Launched | undefined;

/** A long, varied page: numbered rows with text-like bars, so overlap is unambiguous. */
function longPage(count: number, hover = false): string {
  const rows = Array.from({ length: count }, (_, i) => {
    const w = 120 + ((i * 53) % 260);
    return `<div class="r"><b>Row ${i + 1}</b><i style="width:${w}px;background:hsl(${(i * 47) % 360} 60% 45%)"></i></div>`;
  }).join('');
  // Rows light up under the pointer, as list items often do: a repaint without scrolling.
  const hoverCss = hover ? '.r:hover{background:#eef2ff}' : '';
  return `<!doctype html><meta charset="utf-8"><title>long page</title>
<style>body{margin:0;font:16px system-ui;background:#fff;color:#111}.r{display:flex;align-items:center;gap:14px;height:34px;padding:0 16px;border-bottom:1px solid #e5e7eb}i{display:block;height:12px;border-radius:6px}${hoverCss}</style>${rows}`;
}

async function open(html: string, args: string[] = []): Promise<Launched> {
  const launched = await launch(args);
  ctx = launched;
  await launched.app.evaluate(async () => {
    await globalThis.__anyshot?.patch({ capture: { showThumbnail: false, quickAction: 'copy' } });
  });
  await launched.app.evaluate(async ({ BrowserWindow, screen }, html) => {
    const { width, height } = screen.getPrimaryDisplay().bounds;
    const win = new BrowserWindow({ x: 0, y: 0, width, height, frame: false, show: false });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    win.show();
    await new Promise((r) => setTimeout(r, 300));
  }, html);
  return launched;
}

test.afterEach(async () => {
  await verifyAndClose(ctx);
  ctx = undefined;
});

/** Moves the real X pointer (screen pixels): screen captures draw it into their frames. */
function movePointer(x: number, y: number): void {
  execFileSync('xdotool', ['mousemove', String(Math.round(x)), String(Math.round(y))]);
}

function pageScript(app: ElectronApplication, script: string): Promise<unknown> {
  return app.evaluate(({ BrowserWindow }, script) => {
    const page = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().startsWith('data:'),
    );
    return page?.webContents.executeJavaScript(script);
  }, script);
}

/** Selects a 600 × 400 area at the top left for scroll capture and returns the HUD. */
async function startScrollCapture(app: ElectronApplication, size: string): Promise<Page> {
  await dispatch(app, 'scrollCapture');
  const overlay = await pageOf(app, 'overlay');
  await expect
    .poll(() =>
      app.evaluate(() =>
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
  const hud = await pageOf(app, 'scroll');
  await expect(hud.getByTestId('scroll-status')).toContainText(size, { timeout: 10_000 });
  return hud;
}

/** Finishes the capture and returns the size of the image it copied. */
async function finish(app: ElectronApplication, hud: Page) {
  await hud
    .getByTestId('scroll-stop')
    .click()
    .catch(() => {});
  await expect.poll(() => windowKinds(app), { timeout: 15_000 }).toEqual([]);
  return app.evaluate(async ({ clipboard, nativeImage }) => {
    for (const item of await clipboard.read()) {
      if (!item.types.includes('image/png')) continue;
      const blob = (await item.getType('image/png')) as Blob;
      return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).getSize();
    }
    return null;
  });
}

for (const pointer of [null, { x: 300, y: 200 }]) {
  const title = pointer
    ? 'scroll capture works with the mouse pointer over the region'
    : 'scroll capture stitches frames into one tall image';
  test(title, async () => {
    const { app } = await open(longPage(80));
    // Keep the pointer outside the region unless the test puts it inside.
    movePointer(pointer?.x ?? 1000, pointer?.y ?? 700);
    const hud = await startScrollCapture(app, '600 × 400');
    for (let i = 0; i < 6; i++) {
      await pageScript(app, 'window.scrollBy(0, 110)');
      await new Promise((r) => setTimeout(r, 450));
    }
    await expect(hud.getByTestId('scroll-status')).toContainText('600 × 1060');
    await expect(hud.getByTestId('scroll-status')).not.toContainText('Lost track');
    expect(await finish(app, hud)).toEqual({ width: 600, height: 1060 });
  });
}

// Real wheel scrolling is smooth: frames land mid-animation at sub-pixel offsets, and
// with display scaling every scroll position is drawn a little differently. The HUD
// used to report "Lost track" over and over even when scrolling slowly.
for (const scale of [1, 1.5]) {
  test(`slow wheel scrolling keeps track at ${scale * 100} % scaling`, async () => {
    test.setTimeout(90_000);
    const { app } = await open(
      longPage(200, true),
      scale === 1 ? [] : [`--force-device-scale-factor=${scale}`],
    );
    const px = (n: number) => Math.round(n * scale);
    movePointer(1250, 780);
    const hud = await startScrollCapture(app, `${px(600)} × ${px(400)}`);
    // The pointer sits over the page while the wheel turns, as when scrolling by hand.
    movePointer(px(300), px(200));
    const seen = new Set<string>();
    let polling = true;
    const poll = (async () => {
      while (polling) {
        seen.add((await hud.getByTestId('scroll-status').textContent()) ?? '');
        await new Promise((r) => setTimeout(r, 40));
      }
    })();
    for (let i = 0; i < 20; i++) {
      execFileSync('xdotool', ['click', '5']);
      await new Promise((r) => setTimeout(r, 350));
    }
    // A few notches back up, then down again: the stitch follows without adding rows twice.
    for (const button of ['4', '4', '5', '5', '5']) {
      execFileSync('xdotool', ['click', button]);
      await new Promise((r) => setTimeout(r, 350));
    }
    await new Promise((r) => setTimeout(r, 1000));
    polling = false;
    await poll;
    expect([...seen].filter((label) => label.includes('Lost track'))).toEqual([]);
    const scrollY = Number(await pageScript(app, 'window.scrollY'));
    expect(scrollY).toBeGreaterThan(1500);
    const size = await finish(app, hud);
    expect(size?.width).toBe(px(600));
    // Everything scrolled past, once: the first view plus the distance scrolled.
    expect(Math.abs((size?.height ?? 0) - (px(400) + scrollY * scale))).toBeLessThanOrEqual(2);
  });
}
