import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from 'mediabunny';
import { closeFixture, showFixture } from './fixture';
import {
  dispatch,
  type Launched,
  launch,
  pageOf,
  pressClosing,
  processTypes,
  rendererCount,
  verifyAndClose,
  windowKinds,
} from './harness';
import { click, movePointer, releasePointer } from './pointer';

let ctx: Launched;
let dir: string;
let temp: string;

test.beforeEach(async () => {
  await start();
});

async function start(args: string[] = []): Promise<void> {
  ctx = await launch(args);
  dir = join(ctx.userData, 'videos');
  temp = join(ctx.userData, 'tmp');
  await mkdir(temp);
  await ctx.app.evaluate(
    async ({ app }, [dir, temp]) => {
      app.setPath('temp', temp);
      await globalThis.__anyshot?.patch({
        recording: { saveDir: dir, whenDone: 'copyPath', fps: 15, filenameTemplate: 'clip' },
      });
    },
    [dir, temp] as const,
  );
  await showFixture(ctx.app);
}

test.afterEach(async () => {
  await verifyAndClose(ctx);
});

/** Opens the record bar on a 400 × 200 area; returns the overlay. */
async function recordBar(action: 'recordArea' | 'recordGif'): Promise<Page> {
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
  await expect(overlay.getByTestId('start')).toBeVisible();
  return overlay;
}

async function recordFor(
  action: 'recordArea' | 'recordGif',
  ms: number,
  setup?: (overlay: Page) => Promise<void>,
): Promise<string> {
  const before = await readdir(dir).catch((): string[] => []);
  const started = () =>
    ctx.app.evaluate(() => globalThis.__anyshot?.timings.recordingStarted?.length ?? 0);
  const startsBefore = await started();
  const overlay = await recordBar(action);
  await setup?.(overlay);
  await overlay
    .getByTestId('start')
    .click()
    .catch(() => {});
  await expect.poll(() => windowKinds(ctx.app)).toEqual(['recorder']);
  // The window exists before capture starts; time the clip from the recorder's own start.
  await expect.poll(started, { timeout: 15_000 }).toBeGreaterThan(startsBefore);
  const tray = await ctx.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items[0]?.label);
  expect(tray).toBe('Stop recording');
  await new Promise((r) => setTimeout(r, ms));
  await closeFixture(ctx.app);
  await dispatch(ctx.app, 'stopRecording');
  await expect.poll(() => windowKinds(ctx.app), { timeout: 30_000 }).toEqual([]);
  const files = (await readdir(dir)).filter((name) => !before.includes(name));
  expect(files).toHaveLength(1);
  return join(dir, files[0] ?? '');
}

test('records an area to a playable file and stops cleanly', async () => {
  await mkdir(dir);
  for (const ext of ['mp4', 'webm']) await writeFile(join(dir, `clip.${ext}`), 'previous');
  const file = await recordFor('recordArea', 2500);
  expect(file).toMatch(/clip \(2\)\.(mp4|webm)$/);
  for (const ext of ['mp4', 'webm']) {
    expect(await readFile(join(dir, `clip.${ext}`), 'utf8')).toBe('previous');
  }
  const bytes = await readFile(file);
  // Not empty. A still area compresses to ~2 KB with Windows' H.264 encoder; the frame count
  // and duration below are the real checks.
  expect(bytes.length).toBeGreaterThan(1000);
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

test('takes quality and frame rate from Settings', async () => {
  const info = test.info();
  await dispatch(ctx.app, 'settings');
  const settings = await pageOf(ctx.app, 'settings');
  await settings.getByTestId('tab-recording').click();
  const quality = settings.getByRole('combobox', { name: /Video quality/ });
  await expect(quality).toHaveValue('high');
  await quality.selectOption('compact');
  await settings.getByRole('combobox', { name: 'Frame rate' }).selectOption('24');
  await expect(quality).toHaveValue('compact');
  await settings.screenshot({ path: info.outputPath('recording-quality.png') });
  await settings.close();

  await movePointer(150, 150);
  const overlay = await recordBar('recordArea');
  await expect(overlay.getByRole('combobox')).toHaveCount(0);
  await overlay
    .getByTestId('start')
    .click()
    .catch(() => {});
  const recorder = await pageOf(ctx.app, 'recorder');
  const init = await recorder.evaluate(() => window.anyshot.invoke('recorder:init'));
  expect(init).toMatchObject({ quality: 'compact', fps: 24 });
  await expect(recorder.getByRole('button', { name: /Pause/ })).toBeVisible();
  await ctx.app.evaluate(async ({ BrowserWindow }) => {
    const fixture = BrowserWindow.getAllWindows().find(
      (win) =>
        win.webContents.getURL().startsWith('data:') &&
        win.webContents.getTitle() === 'Fixture desktop',
    );
    if (!fixture) throw new Error('Recording fixture missing');
    fixture.webContents.setBackgroundThrottling(false);
    await fixture.webContents.executeJavaScript(`void document.querySelector('.card').animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(100px)' }],
      { duration: 900, direction: 'alternate', iterations: Infinity }
    )`);
  });
  await new Promise((resolve) => setTimeout(resolve, 2200));
  await dispatch(ctx.app, 'stopRecording');
  await expect.poll(() => windowKinds(ctx.app), { timeout: 15_000 }).toEqual([]);
  const [file] = await readdir(dir);
  if (!file) throw new Error('Recording was not saved');
  const input = new Input({
    source: new BufferSource(await readFile(join(dir, file))),
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryVideoTrack();
    expect({ width: track?.displayWidth, height: track?.displayHeight }).toEqual({
      width: init.crop.width,
      height: init.crop.height,
    });
    let frames = 0;
    if (track) for await (const _packet of new EncodedPacketSink(track).packets()) frames++;
    expect(frames).toBeGreaterThan(1);
  } finally {
    input.dispose();
  }
  await copyFile(join(dir, file), info.outputPath(file));
});

test('records a GIF via an intermediate video that is removed afterwards', async () => {
  const file = await recordFor('recordGif', 2000);
  expect(file.endsWith('.gif')).toBe(true);
  const bytes = await readFile(file);
  expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a');
  expect(bytes[bytes.length - 1]).toBe(0x3b);
  expect(await readdir(temp)).toEqual([]);
  await dispatch(ctx.app, 'settings');
  const page = await pageOf(ctx.app, 'settings');
  const gif = await page.evaluate(async (base64) => {
    const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const decoder = new ImageDecoder({ data, type: 'image/gif' });
    try {
      await decoder.tracks.ready;
      const delays = [];
      for (const frameIndex of [0, 1, 2]) {
        const { image } = await decoder.decode({ frameIndex });
        delays.push(image.duration);
        image.close();
      }
      return { count: decoder.tracks.selectedTrack?.frameCount, delays };
    } finally {
      decoder.close();
    }
  }, bytes.toString('base64'));
  expect(gif.count).toBeGreaterThan(10);
  expect(gif.delays).toEqual([70_000, 60_000, 70_000]);
});

const recordingSettings = () =>
  ctx.app.evaluate(
    () =>
      (globalThis.__anyshot?.settings() as { recording: Record<string, unknown> } | undefined)
        ?.recording ?? {},
  );

test('the record bar toggles the microphone and computer audio, and remembers them', async () => {
  const overlay = await recordBar('recordArea');
  const mic = overlay.getByTestId('audio-mic');
  const system = overlay.getByTestId('audio-system');
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await expect(mic).toHaveAttribute('title', 'Microphone: on (M)');
  await expect.poll(async () => (await recordingSettings()).microphone).toBe(true);
  await overlay.keyboard.press('m');
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await recordingSettings()).microphone).toBe(false);
  // A click leaves focus alone, so Enter would still start the recording...
  expect(await mic.evaluate((el) => el === document.activeElement)).toBe(false);
  // ...but a toggle reached with the keyboard takes its own Enter and Space.
  await mic.focus();
  await overlay.keyboard.press('Enter');
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await overlay.keyboard.press(' ');
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  expect(await windowKinds(ctx.app)).not.toContain('recorder');
  if (process.platform === 'win32') {
    // Windows records computer audio through loopback: A toggles it and it is remembered.
    await expect(system).toBeEnabled();
    await overlay.keyboard.press('a');
    await expect(system).toHaveAttribute('aria-pressed', 'true');
    await expect(system).toHaveAttribute('title', 'Computer audio: on (A)');
    await expect.poll(async () => (await recordingSettings()).systemAudio).toBe(true);
    await overlay.keyboard.press('a');
    await expect(system).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await recordingSettings()).systemAudio).toBe(false);
  } else {
    // Linux has no loopback capture: computer audio is off and explains why.
    await expect(system).toBeDisabled();
    await expect(system).toHaveAttribute('title', /only be recorded on Windows/);
    await overlay.keyboard.press('a');
    expect((await recordingSettings()).systemAudio).toBe(false);
  }
  await pressClosing(overlay, 'Escape');
  await expect.poll(() => windowKinds(ctx.app)).toEqual([]);

  // GIFs have no audio, so no toggles.
  const gif = await recordBar('recordGif');
  await expect(gif.getByTestId('audio-mic')).toHaveCount(0);
  await expect(gif.getByTestId('audio-system')).toHaveCount(0);
  await pressClosing(gif, 'Escape');
});

test('records microphone audio when its toggle is on', async () => {
  // Chromium's fake capture devices give the recorder a microphone under Xvfb.
  await verifyAndClose(ctx);
  await start(['--use-fake-device-for-media-stream']);
  const file = await recordFor('recordArea', 2500, async (overlay) => {
    await overlay.getByTestId('audio-mic').click();
    await expect(overlay.getByTestId('audio-mic')).toHaveAttribute('aria-pressed', 'true');
  });
  const input = new Input({ source: new BufferSource(await readFile(file)), formats: ALL_FORMATS });
  const audio = await input.getPrimaryAudioTrack();
  expect(audio).not.toBeNull();
  expect(await audio?.computeDuration()).toBeGreaterThan(1);
  expect(await input.getPrimaryVideoTrack()).not.toBeNull();
});

// Windows records computer audio through loopback. Nothing has to be playing: a silent
// output must still give an audio track that lasts as long as the video.
for (const microphone of [false, true]) {
  test(`records computer audio${microphone ? ' mixed with the microphone' : ''} (Windows)`, async () => {
    test.skip(process.platform !== 'win32', 'Computer audio is only recorded on Windows');
    await verifyAndClose(ctx);
    await start(microphone ? ['--use-fake-device-for-media-stream'] : []);
    const file = await recordFor('recordArea', 2500, async (overlay) => {
      const system = overlay.getByTestId('audio-system');
      await system.click();
      await expect(system).toHaveAttribute('aria-pressed', 'true');
      if (microphone) await overlay.getByTestId('audio-mic').click();
    });
    const input = new Input({
      source: new BufferSource(await readFile(file)),
      formats: ALL_FORMATS,
    });
    const audio = await input.getPrimaryAudioTrack();
    const video = await input.getPrimaryVideoTrack();
    expect(audio).not.toBeNull();
    expect(video).not.toBeNull();
    const [audioSeconds, videoSeconds] = [
      await audio?.computeDuration(),
      await video?.computeDuration(),
    ];
    console.log(
      `computer audio: audio ${audioSeconds?.toFixed(2)} s, video ${videoSeconds?.toFixed(2)} s`,
    );
    expect(audioSeconds).toBeGreaterThan(1.5);
    expect(videoSeconds).toBeGreaterThan(1.5);
    expect(Math.abs((audioSeconds ?? 0) - (videoSeconds ?? 0))).toBeLessThan(0.3);
  });
}

const borderWindows = () =>
  ctx.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && w.getTitle() === 'anyshot recording border')
      .map((w) => w.getBounds()),
  );

const recorderWindow = () =>
  ctx.app.evaluate(() => globalThis.__anyshot?.windows().find((w) => w.kind === 'recorder'));

const trayFirstItems = () =>
  ctx.app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items ?? []).slice(0, 2).map((i) => i.label),
  );

/** Starts recording the 401 × 201 area at (100, 100) from the record bar; returns when Start was clicked. */
async function startRecording(): Promise<number> {
  const overlay = await recordBar('recordArea');
  const clickedAt = Date.now();
  await overlay
    .getByTestId('start')
    .click()
    .catch(() => {});
  await expect.poll(() => windowKinds(ctx.app)).toEqual(['recorder']);
  return clickedAt;
}

/** Waits, polling every few ms, until the controls show a running recording. */
async function waitForRecordingPhase(hud: Page): Promise<void> {
  await hud.waitForFunction(
    () =>
      document.querySelector<HTMLElement>('[data-testid="recording-hud"]')?.dataset.phase ===
      'recording',
    null,
    { polling: 5, timeout: 15_000 },
  );
}

test('the recording controls show the time, pause and resume, and stop', async () => {
  const before = await readdir(dir).catch((): string[] => []);
  await startRecording();
  const hud = await pageOf(ctx.app, 'recorder');
  await waitForRecordingPhase(hud);
  // From when capture runs to the Stop click: no capture startup or saving in it.
  const capturingFrom = Date.now();
  // Shown once capture runs: just below the area, which a red border frames from outside.
  await expect.poll(async () => (await recorderWindow())?.visible).toBe(true);
  const hudBounds = (await recorderWindow())?.bounds;
  expect(hudBounds?.y).toBe(100 + 201 + 10);
  // One frame window, 2 px larger on every side: its line sits just outside the area.
  await expect.poll(borderWindows).toEqual([{ x: 98, y: 98, width: 405, height: 205 }]);

  const time = hud.getByTestId('recording-time');
  await expect(time).toHaveText(/^0:0[1-9]$/, { timeout: 5_000 });
  expect(await trayFirstItems()).toEqual(['Stop recording', 'Pause recording']);

  // Pause from the controls: the clock and the video stand still.
  await hud.getByTestId('recording-pause').click();
  await expect(hud.getByTestId('recording-hud')).toHaveAttribute('data-phase', 'paused');
  await expect(hud.getByTestId('recording-pause')).toHaveAttribute('title', 'Resume recording');
  await expect.poll(trayFirstItems).toEqual(['Stop recording', 'Resume recording']);
  const pausedLabel = await time.textContent();
  await new Promise((r) => setTimeout(r, 2500));
  expect(await time.textContent()).toBe(pausedLabel);

  // Resume the way the tray and `--pause-recording` do, then stop from the controls.
  await dispatch(ctx.app, 'togglePauseRecording');
  await expect(hud.getByTestId('recording-hud')).toHaveAttribute('data-phase', 'recording');
  await expect.poll(trayFirstItems).toEqual(['Stop recording', 'Pause recording']);
  await new Promise((r) => setTimeout(r, 1000));
  const capturedSeconds = (Date.now() - capturingFrom) / 1000;
  await hud
    .getByTestId('recording-stop')
    .click()
    .catch(() => {});
  await expect.poll(() => windowKinds(ctx.app), { timeout: 30_000 }).toEqual([]);
  expect(await borderWindows()).toEqual([]);

  const files = (await readdir(dir)).filter((name) => !before.includes(name));
  expect(files).toHaveLength(1);
  const input = new Input({
    source: new BufferSource(await readFile(join(dir, files[0] ?? ''))),
    formats: ALL_FORMATS,
  });
  const duration = await input.computeDuration();
  console.log(
    `paused recording: ${duration.toFixed(2)} s of video, ${capturedSeconds.toFixed(2)} s captured`,
  );
  // About a second before the pause and a second after it. Had the 2.5 s pause been
  // recorded, the video would last about as long as the capture.
  expect(duration).toBeGreaterThan(1.5);
  expect(duration).toBeLessThan(capturedSeconds - 1.5);
});

test('a pause as soon as recording starts leaves the same gap out of audio and video', async () => {
  // Pausing before a track's first sample used to put that sample after the pause, out
  // of step with the other track. Here it often has started already; the unit tests of
  // the pause gate cover the order of events.
  await verifyAndClose(ctx);
  await start(['--use-fake-device-for-media-stream']);
  const before = await readdir(dir).catch((): string[] => []);
  const overlay = await recordBar('recordArea');
  await overlay.getByTestId('audio-mic').click();
  await overlay
    .getByTestId('start')
    .click()
    .catch(() => {});
  const hud = await pageOf(ctx.app, 'recorder');
  await waitForRecordingPhase(hud);
  await hud.getByTestId('recording-pause').evaluate((button: HTMLElement) => button.click());
  await expect(hud.getByTestId('recording-hud')).toHaveAttribute('data-phase', 'paused');
  await new Promise((r) => setTimeout(r, 2000));
  await dispatch(ctx.app, 'togglePauseRecording');
  await expect(hud.getByTestId('recording-hud')).toHaveAttribute('data-phase', 'recording');
  await new Promise((r) => setTimeout(r, 1500));
  await dispatch(ctx.app, 'stopRecording');
  await expect.poll(() => windowKinds(ctx.app), { timeout: 30_000 }).toEqual([]);

  const [name] = (await readdir(dir)).filter((n) => !before.includes(n));
  const input = new Input({
    source: new BufferSource(await readFile(join(dir, name ?? ''))),
    formats: ALL_FORMATS,
  });
  const audioTrack = await input.getPrimaryAudioTrack();
  const videoTrack = await input.getPrimaryVideoTrack();
  expect(audioTrack).not.toBeNull();
  expect(videoTrack).not.toBeNull();
  const audio = (await audioTrack?.computeDuration()) ?? 0;
  const video = (await videoTrack?.computeDuration()) ?? 0;
  console.log(`paused at once: audio ${audio.toFixed(2)} s, video ${video.toFixed(2)} s`);
  // The 1.5 s after Resume, in both tracks, and not the 2 s pause.
  expect(audio).toBeGreaterThan(1.2);
  expect(video).toBeGreaterThan(1.2);
  expect(video).toBeLessThan(2.8);
  expect(Math.abs(audio - video)).toBeLessThan(0.3);
});

test('a pause leaves the same gap out of the audio and the video', async () => {
  // Chromium's fake capture devices give the recorder a microphone.
  await verifyAndClose(ctx);
  await start(['--use-fake-device-for-media-stream']);
  const before = await readdir(dir).catch((): string[] => []);
  const overlay = await recordBar('recordArea');
  await overlay.getByTestId('audio-mic').click();
  await expect(overlay.getByTestId('audio-mic')).toHaveAttribute('aria-pressed', 'true');
  await overlay
    .getByTestId('start')
    .click()
    .catch(() => {});
  const hud = await pageOf(ctx.app, 'recorder');
  await expect(hud.getByTestId('recording-hud')).toHaveAttribute('data-phase', 'recording', {
    timeout: 15_000,
  });
  await new Promise((r) => setTimeout(r, 1200));
  await dispatch(ctx.app, 'togglePauseRecording');
  await expect(hud.getByTestId('recording-hud')).toHaveAttribute('data-phase', 'paused');
  await new Promise((r) => setTimeout(r, 2000));
  await dispatch(ctx.app, 'togglePauseRecording');
  await expect(hud.getByTestId('recording-hud')).toHaveAttribute('data-phase', 'recording');
  await new Promise((r) => setTimeout(r, 1200));
  await dispatch(ctx.app, 'stopRecording');
  await expect.poll(() => windowKinds(ctx.app), { timeout: 30_000 }).toEqual([]);

  const [name] = (await readdir(dir)).filter((n) => !before.includes(n));
  const input = new Input({
    source: new BufferSource(await readFile(join(dir, name ?? ''))),
    formats: ALL_FORMATS,
  });
  const audio = await (await input.getPrimaryAudioTrack())?.computeDuration();
  const video = await (await input.getPrimaryVideoTrack())?.computeDuration();
  console.log(`paused with audio: audio ${audio?.toFixed(2)} s, video ${video?.toFixed(2)} s`);
  // About 2.4 s recorded around a 2 s pause, in both tracks, which still line up.
  expect(video).toBeGreaterThan(1.8);
  expect(video).toBeLessThan(3.6);
  expect(Math.abs((audio ?? 0) - (video ?? 0))).toBeLessThan(0.3);
});

// The border window lies over the area (its inside is transparent): real clicks and the
// wheel must still reach the app being recorded.
test('the app under the recording border still gets real clicks', async () => {
  await ctx.app.evaluate(({ BrowserWindow }) => {
    const fixture = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Fixture desktop');
    return fixture?.webContents.executeJavaScript(
      'window.__clicks = 0; addEventListener("mousedown", () => window.__clicks++); 0',
    );
  });
  const clicks = () =>
    ctx.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === 'Fixture desktop')
        ?.webContents.executeJavaScript('window.__clicks'),
    );
  await startRecording();
  await expect.poll(borderWindows).toHaveLength(1);
  await expect.poll(async () => (await borderWindows())[0]?.width).toBe(405);
  const scale = await ctx.app.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor);
  try {
    // Inside the recorded area (100, 100, 401 × 201), well away from its edge.
    await movePointer(300 * scale, 200 * scale);
    await click();
    await expect.poll(clicks).toBe(1);
  } finally {
    await movePointer(1000 * scale, 700 * scale);
    releasePointer();
  }
  await dispatch(ctx.app, 'stopRecording');
  await expect.poll(() => windowKinds(ctx.app), { timeout: 30_000 }).toEqual([]);
});

test('with the controls turned off, recording shows neither controls nor border', async () => {
  await ctx.app.evaluate(async () => {
    await globalThis.__anyshot?.patch({ recording: { showControls: false } });
  });
  await startRecording();
  await expect
    .poll(() => ctx.app.evaluate(() => globalThis.__anyshot?.timings.recordingStarted?.length ?? 0))
    .toBeGreaterThan(0);
  await new Promise((r) => setTimeout(r, 500));
  expect((await recorderWindow())?.visible).toBe(false);
  expect(await borderWindows()).toEqual([]);
  await dispatch(ctx.app, 'stopRecording');
  await expect.poll(() => windowKinds(ctx.app), { timeout: 30_000 }).toEqual([]);
});

// With the whole screen selected there is no room beside it, so the controls go inside the
// area. Windows leaves windows with content protection out of screen captures.
test('controls inside the recorded area stay out of the video (Windows)', async () => {
  test.skip(process.platform !== 'win32', 'Only Windows excludes windows from capture');
  const before = await readdir(dir).catch((): string[] => []);
  await dispatch(ctx.app, 'recordArea');
  const overlay = await pageOf(ctx.app, 'overlay');
  await expect
    .poll(() =>
      ctx.app.evaluate(() =>
        globalThis.__anyshot?.windows().some((w) => w.kind === 'overlay' && w.visible),
      ),
    )
    .toBe(true);
  const screen = await overlay.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await overlay.mouse.move(0, 0);
  await overlay.mouse.down();
  await overlay.mouse.move(screen.width, screen.height, { steps: 4 });
  await overlay.mouse.up();
  await overlay
    .getByTestId('start')
    .click()
    .catch(() => {});
  await expect.poll(async () => (await recorderWindow())?.visible).toBe(true);
  const hud = (await recorderWindow())?.bounds;
  if (!hud) throw new Error('no controls');
  expect(hud.y + hud.height).toBeLessThanOrEqual(screen.height);
  await new Promise((r) => setTimeout(r, 1500));
  await dispatch(ctx.app, 'stopRecording');
  await expect.poll(() => windowKinds(ctx.app), { timeout: 30_000 }).toEqual([]);

  const [file] = (await readdir(dir)).filter((name) => !before.includes(name));
  const input = new Input({
    source: new BufferSource(await readFile(join(dir, file ?? ''))),
    formats: ALL_FORMATS,
  });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('no video');
  const config = await track.getDecoderConfig();
  if (!config) throw new Error('no decoder config');
  const packets: { data: string; timestamp: number; key: boolean }[] = [];
  for await (const packet of new EncodedPacketSink(track).packets()) {
    packets.push({
      data: Buffer.from(packet.data).toString('base64'),
      timestamp: Math.round(packet.timestamp * 1e6),
      key: packet.type === 'key',
    });
  }
  // Decode in a renderer (WebCodecs) and read the pixels where the controls were.
  await dispatch(ctx.app, 'settings');
  const page = await pageOf(ctx.app, 'settings');
  const scale = track.displayWidth / screen.width;
  const spot = {
    x: Math.round((hud.x + hud.width / 2) * scale),
    y: Math.round((hud.y + hud.height / 2) * scale),
  };
  const pixel = await page.evaluate(
    async ({ config, packets, spot }) => {
      const description = config.description
        ? Uint8Array.from(atob(config.description as unknown as string), (c) => c.charCodeAt(0))
        : undefined;
      let last: VideoFrame | null = null;
      const decoder = new VideoDecoder({
        output: (frame) => {
          last?.close();
          last = frame;
        },
        error: (error) => {
          throw error;
        },
      });
      decoder.configure({ ...config, ...(description ? { description } : {}) });
      for (const p of packets) {
        const data = Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0));
        decoder.decode(
          new EncodedVideoChunk({ type: p.key ? 'key' : 'delta', timestamp: p.timestamp, data }),
        );
      }
      await decoder.flush();
      const frame = last as VideoFrame | null;
      if (!frame) return null;
      const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
      const ctx2d = canvas.getContext('2d');
      ctx2d?.drawImage(frame, 0, 0);
      frame.close();
      decoder.close();
      return Array.from(ctx2d?.getImageData(spot.x, spot.y, 1, 1).data ?? []).slice(0, 3);
    },
    {
      config: {
        ...config,
        description: config.description
          ? Buffer.from(config.description as ArrayBuffer).toString('base64')
          : undefined,
      } as unknown as VideoDecoderConfig,
      packets,
      spot,
    },
  );
  console.log(`under the controls the video shows rgb(${pixel?.join(', ')})`);
  // The fixture desktop's blue, not the controls' dark bar (video compression shifts it a bit).
  const [r = 0, g = 0, b = 0] = pixel ?? [];
  expect(Math.abs(r - 30)).toBeLessThan(25);
  expect(Math.abs(g - 64)).toBeLessThan(25);
  expect(Math.abs(b - 175)).toBeLessThan(25);
});
