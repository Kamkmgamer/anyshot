import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from 'mediabunny';
import { closeFixture, showFixture } from './fixture';
import {
  dispatch,
  type Launched,
  launch,
  pageOf,
  processTypes,
  rendererCount,
  windowKinds,
} from './harness';

let ctx: Launched;
let dir: string;

test.beforeEach(async () => {
  ctx = await launch();
  dir = join(ctx.userData, 'videos');
  await ctx.app.evaluate(async (_e, dir) => {
    await globalThis.__anyshot?.patch({
      recording: { saveDir: dir, whenDone: 'copyPath', fps: 15 },
    });
  }, dir);
  await showFixture(ctx.app);
});

test.afterEach(async () => {
  expect(ctx.errors).toEqual([]);
  await ctx.close();
});

async function recordFor(action: 'recordArea' | 'recordGif', ms: number): Promise<string> {
  await dispatch(ctx.app, action);
  const overlay = await pageOf(ctx.app, 'overlay');
  await expect
    .poll(() =>
      ctx.app.evaluate(() =>
        globalThis.__anyshot?.windows().some((w) => w.kind === 'overlay' && w.visible),
      ),
    )
    .toBe(true);
  await overlay.mouse.move(100, 100);
  await overlay.mouse.down();
  await overlay.mouse.move(501, 301, { steps: 4 });
  await overlay.mouse.up();
  await overlay
    .getByTestId('start')
    .click()
    .catch(() => {});
  await expect.poll(() => windowKinds(ctx.app)).toEqual(['recorder']);
  const tray = await ctx.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items[0]?.label);
  expect(tray).toBe('Stop recording');
  await new Promise((r) => setTimeout(r, ms));
  await closeFixture(ctx.app);
  await dispatch(ctx.app, 'stopRecording');
  await expect.poll(() => windowKinds(ctx.app), { timeout: 30_000 }).toEqual([]);
  const files = await readdir(dir);
  expect(files).toHaveLength(1);
  return join(dir, files[0] ?? '');
}

test('records an area to a playable file and stops cleanly', async () => {
  const file = await recordFor('recordArea', 2500);
  const bytes = await readFile(file);
  expect(bytes.length).toBeGreaterThan(2000);
  const isMp4 = bytes.subarray(4, 8).toString('latin1') === 'ftyp';
  const isWebm = bytes.readUInt32BE(0) === 0x1a45dfa3;
  expect(isMp4 || isWebm).toBe(true);
  // Demux it: a real video track with a plausible duration and frame count.
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  expect(track?.displayWidth).toBe(400);
  expect(track?.displayHeight).toBe(200);
  const duration = await input.computeDuration();
  let packets = 0;
  if (track) for await (const _packet of new EncodedPacketSink(track).packets()) packets++;
  console.log(
    `recording: ${file.split('.').pop()} ${bytes.length} bytes, ${duration.toFixed(2)} s, ${packets} frames, ${track?.codec}`,
  );
  expect(duration).toBeGreaterThan(1.5);
  expect(packets).toBeGreaterThan(10);
  const copied = await ctx.app.evaluate(({ clipboard }) => clipboard.readText());
  expect(copied).toBe(file);
  await expect
    .poll(async () => rendererCount(await processTypes(ctx.app)), { timeout: 30_000 })
    .toBe(0);
});

test('records a GIF via an intermediate video that is removed afterwards', async () => {
  const file = await recordFor('recordGif', 2000);
  expect(file.endsWith('.gif')).toBe(true);
  const bytes = await readFile(file);
  expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a');
  expect(bytes[bytes.length - 1]).toBe(0x3b);
  console.log(`gif: ${bytes.length} bytes`);
});
