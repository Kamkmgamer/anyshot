import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { FIXTURE, showFixture } from './fixture';
import { dispatch, type Launched, launch, pageOf, pressClosing, verifyAndClose } from './harness';

let ctx: Launched;
let server: Server;
let received: Buffer[] = [];

test.beforeEach(async () => {
  received = [];
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    // Only count uploads; local tooling may probe open ports with other requests.
    if (req.method === 'POST' && req.url === '/upload') received.push(Buffer.concat(chunks));
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end('{"link":"https://img.example/u1.png"}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/upload`;
  ctx = await launch();
  await ctx.app.evaluate(async (_e, url) => {
    await globalThis.__anyshot?.patch({
      capture: { showThumbnail: false },
      uploads: {
        provider: 'http',
        confirmBeforeUpload: false,
        http: { url, responseUrlPath: 'link' },
      },
    });
  }, url);
  await showFixture(ctx.app);
});

test.afterEach(async () => {
  try {
    await verifyAndClose(ctx);
  } finally {
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('U uploads the capture and puts the link on the clipboard', async () => {
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
  await overlay.mouse.move(card.x + card.width, card.y + card.height, { steps: 4 });
  await overlay.mouse.up();
  await expect(overlay.getByTestId('action-upload')).toBeVisible();
  await pressClosing(overlay, 'u');
  await expect
    .poll(() => ctx.app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('https://img.example/u1.png');
  expect(received).toHaveLength(1);
  // The multipart body carries a PNG.
  expect(received[0]?.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
});
