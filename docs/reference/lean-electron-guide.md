Architecture guide · Windows + Linux · Electron + TypeScript

# Lean Electron Capture App

How to build a macshot-style screenshot and recording tool in Electron, entirely in TypeScript, that sits near 0% CPU when idle, keeps memory low, and opens the capture overlay fast.

## The short version

1. Idle means **one process**: the main process with a tray icon and global shortcuts. No windows, no timers.
2. **No Rust needed.** Use prebuilt native npm packages for the few things JavaScript can't do fast (screen grabs, image encoding), and TypeScript for everything else.
3. Move screenshots as **raw pixels over a custom protocol**, never as base64 over IPC.
4. Create windows **when needed** and destroy them after. One pre-warmed overlay is an opt-in setting.
5. Draw on **layered canvases** outside React; blur and pixelate run as WebGL shaders.
6. Record with **Chromium's own pipeline**: screen stream → WebCodecs hardware encoder → MP4 written to disk as it goes.
7. Run heavy work in **short-lived utility processes or workers**, then shut them down.
8. Set **numeric budgets** and test them in CI.

**Contents**

1. [Stack at a glance](#stack)
2. [Know the floor](#floor)
3. [Process layout](#layout)
4. [Project setup](#setup)
5. [Idle: one process, zero wakeups](#idle)
6. [Capturing the screen](#capture)
7. [Windows and the overlay](#windows)
8. [Drawing and annotation](#drawing)
9. [Screen recording](#recording)
10. [OCR, GIFs, images, history](#heavy)
11. [Linux and Wayland](#linux)
12. [Security, packaging, updates](#ship)
13. [Budgets and tests](#budgets)
14. [Mistakes to avoid](#mistakes)
15. [Build order](#order)
16. [Licence and later options](#later)

## 1. Stack at a glance

| Concern | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict) everywhere | One language for main, windows and workers. |
| Dev and build | electron-vite | Separate bundles for main, preload and each window; fast reloads. |
| Packaging and updates | electron-builder + electron-updater | NSIS installer for Windows; AppImage, deb and rpm for Linux; updates from GitHub Releases. |
| Screen grabs | `node-screenshots` (prebuilt), with Electron's `desktopCapturer` as fallback | Fast full-resolution grabs without writing native code. |
| Annotation canvas | Plain TypeScript + Canvas 2D, WebGL for effects | The hot path stays out of the UI framework. |
| UI chrome | React (or Preact/Solid) + a small store such as Zustand | Toolbars, popovers, settings and history only. |
| Recording | `getDisplayMedia` + WebCodecs `VideoEncoder` + Mediabunny | Hardware H.264 where available, MP4 written as it records. |
| GIF export | `gifenc` in a Web Worker | Small, fast, frame-by-frame. |
| Image encode and thumbnails | `sharp` (prebuilt libvips) in a utility process | Fast PNG/JPEG/WebP/AVIF without blocking anything. |
| OCR | `tesseract.js` in a utility process | Offline, cross-platform; loaded only when used. |
| Settings | Small JSON file written atomically (or `electron-store`) | No database to keep loaded. |
| Tests | Vitest for logic, Playwright's Electron support for end-to-end and performance budgets | Budgets checked on every change. |

**Check before you commit to a package:** recent releases, open issues for Linux and Wayland, and whether it ships prebuilt binaries for your Electron version. Packages built on Node-API (node-screenshots and sharp are) normally work in Electron without rebuilding.

## 2. Know the floor

Electron carries Chromium, so it has a memory floor that native apps don't. Each window adds a renderer process, and Chromium runs a few helper processes (GPU and network) alongside main. You can't remove that floor; you can avoid paying more than it while the app is idle.

The main rule: **renderers only exist while the user is capturing, recording or editing**. Between captures, the app is main plus Chromium's unavoidable helpers, with no work happening.

## 3. Process layout

### Always running

**main**Tray, global shortcuts, settings, window lifecycle, capture calls. Event-driven only.

**Chromium helpers**Started by Electron itself. Nothing for you to manage, but count them in your budget.

### Started on demand, stopped after

**overlay window × displays**Frameless, transparent, one per monitor. Destroyed after capture (or one kept warm).

**recorder window**Hidden window that owns the screen stream and encoder while recording.

**editor / settings / history windows**Created when opened, destroyed on close.

**utilityProcess: image, ocr**sharp and tesseract.js. Forked per job, exit after a short idle timeout.

**web workers**GIF encoding, scroll stitching, edge detection for snapping. Inside the window that needs them.

Apps that feel fast in Electron, T3 Code among them, keep the shell thin and push heavy work elsewhere. Read T3 Code's desktop package for patterns, but measure your own app instead of copying flags.

## 4. Project setup

```
src/
  main/            tray, hotkeys, windows, capture, protocol, ipc handlers
  preload/         one tiny preload per window type, exposes typed APIs
  shared/          ipc contract types, settings schema
  windows/
    overlay/       selection + canvas engine + toolbars   (first to load, smallest)
    editor/        reuses the canvas engine
    recorder/      hidden: stream, encoder, muxer
    settings/  history/
  engine/          canvas engine: plain TS, no UI framework imports
  workers/         gif, stitch, snap-index
  utility/         image.ts (sharp), ocr.ts (tesseract.js)
```

- **One entry per window.** Each window loads only its own bundle. The overlay bundle should be the smallest thing you ship.
- **Typed IPC.** Define every channel once in `shared/ipc.ts` (name, request type, response type) and use it on both sides. Use `ipcRenderer.invoke` / `ipcMain.handle`, not sync IPC.
- **Validate senders.** In each handler, check that `event.senderFrame.url` starts with your `app://` origin.
- **Lazy imports in main.** Load features with `await import()` the first time they're used, so startup memory stays small.
- **Faster window starts.** Set `v8CacheOptions: 'bypassHeatCheck'` in `webPreferences` so V8 caches compiled window code from the first run.

## 5. Idle: one process, zero wakeups

- Call `app.requestSingleInstanceLock()` and handle `second-instance`. That also gives you command-line actions such as `myapp --capture` for free (useful on Linux, see section 11).
- Create no `BrowserWindow` at startup.
- No `setInterval` in main. React to events: `screen.on('display-added' | 'display-removed' | 'display-metrics-changed')`, `powerMonitor` for sleep and resume.
- Never poll the clipboard; read it only when the user asks.
- Check for updates once a day with random jitter.
- Don't load `sharp`, `tesseract.js` or other large modules in main; they belong in utility processes.

```
// main/index.ts — tray-only startup
if (!app.requestSingleInstanceLock()) app.quit();

app.on('second-instance', (_e, argv) => {
  if (argv.includes('--capture')) startCapture();
  if (argv.includes('--record')) startRecording();
});

app.whenReady().then(() => {
  registerAppProtocol();                    // section 6
  tray = new Tray(trayIconPath);            // static icon
  tray.setContextMenu(buildMenu());          // rebuilt only when settings change
  registerHotkeys(settings.hotkeys);         // globalShortcut.register(...)
});

app.on('window-all-closed', () => { /* stay in the tray: do not quit */ });
```

## 6. Capturing the screen

Use `node-screenshots` to grab each monitor at full resolution. Ask for raw RGBA if the package offers it; otherwise take its cheapest format. Electron's `desktopCapturer` is the fallback, and on Wayland it's the main path (section 11).

### Getting pixels into the overlay without copies

Serve both your window code and capture frames from one privileged scheme, `app://`. Same origin means no CORS setup, and the frame is fetched as a binary body with no base64.

```
// before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// frames: Map<string, { rgba: Buffer; width: number; height: number }>
function registerAppProtocol() {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    if (url.host === 'capture') {
      const frame = frames.get(url.pathname.slice(1));
      if (!frame) return new Response(null, { status: 404 });
      return new Response(frame.rgba, { headers: { 'content-type': 'application/octet-stream' } });
    }
    return serveBundledFile(url);            // your window HTML/JS/CSS
  });
}
```

```
// overlay window: width and height arrive by IPC with the capture id
const buf = await (await fetch(`app://capture/${id}`)).arrayBuffer();
const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(buf), width, height));
window.api.frameReceived(id);                // main deletes the buffer now
staticLayer.getContext('2d')!.drawImage(bitmap, 0, 0);
```

- **DPI.** Capture in physical pixels. Size the overlay window to `display.bounds` (CSS pixels) and the canvas backing store to physical pixels, using `display.scaleFactor`.
- **Speed order.** Grab the display under the pointer first and show its overlay immediately; grab the others after.
- **Encoding.** Never encode PNG just to show the overlay. Encode only on copy or save, in the image utility process, and pass the result to `clipboard.writeImage(nativeImage.createFromBuffer(png))`.
- **Window snapping.** If your capture package lists windows with their bounds, use that for window snap mode. Element-level snapping (buttons, page regions) is a later, platform-specific feature.

## 7. Windows and the overlay

Creating a renderer takes noticeable time, so this is the main speed versus memory trade-off. Offer it as a setting:

- **Low memory (default):** create overlays on the hotkey, destroy them when the capture finishes.
- **Instant capture:** keep one hidden overlay loaded and move it to the right display on the hotkey. Costs about one renderer of memory and no CPU while hidden.

```
const overlay = new BrowserWindow({
  show: false, frame: false, transparent: true, resizable: false, movable: false,
  skipTaskbar: true, hasShadow: false, fullscreenable: false,
  webPreferences: {
    preload: overlayPreload, sandbox: true, contextIsolation: true, nodeIntegration: false,
    spellcheck: false, backgroundThrottling: true, v8CacheOptions: 'bypassHeatCheck',
  },
});
overlay.setAlwaysOnTop(true, 'screen-saver');
overlay.setVisibleOnAllWorkspaces(true);
overlay.setBounds(display.bounds);
overlay.loadURL('app://bundle/overlay.html');
overlay.once('ready-to-show', () => overlay.show());
```

- Use one overlay per display. One window spanning monitors with different scaling gives blurry or misaligned results.
- Keep the overlay HTML tiny: inline its critical CSS, load the drawing engine first, lazy-load less common tools.
- Close means `destroy()`. A hidden editor or settings window keeps its whole renderer.
- Before a window goes away, call `close()` on `ImageBitmap`s, revoke object URLs and set canvas sizes to 0 so memory is released at once.
- Floating windows (thumbnail preview, pins, upload toast) can share one small renderer: one transparent window per screen corner that draws several items, instead of one window per item.

## 8. Drawing and annotation

- **Three canvas layers.** Static screenshot (drawn once), committed annotations (redrawn when something is added or edited), and an interaction layer for the stroke in progress, handles and guides.
- **Coalesce input.** Gather pointer events, use `getCoalescedEvents()` for smooth pencil strokes, paint once per `requestAnimationFrame`.
- **Framework only for chrome.** The engine is plain TypeScript with its own small store. React subscribes to coarse state (current tool, colour, selection) and never re-renders on pointer moves.
- **Effects on the GPU.** Blur, pixelate, spotlight dimming and colour adjustments as WebGL fragment shaders over the selected region. Cache the result until the region moves.
- **Annotation model.** Store annotations as plain serialisable objects (tool, points, style). This gives you undo/redo as a list of changes, copy/paste, and editable history and project files almost for free.
- **Snapping data once.** Build edge and window-snap indexes in a worker once per capture, not on every mouse move.
- **Export by replay.** To produce the final image, draw the screenshot and replay the annotations onto an `OffscreenCanvas` at full resolution in a worker.

## 9. Screen recording

Recording runs in a hidden **recorder window** that exists only while recording. Media and encoding APIs live in renderers, and this keeps them out of the overlay.

1. **Choose the source in main.** Electron routes `getDisplayMedia` through a handler you set once:

   ```
   session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
     const sources = await desktopCapturer.getSources({ types: ['screen'] });
     const source = sources.find((s) => s.display_id === String(pending.displayId)) ?? sources[0];
     callback({ video: source, audio: process.platform === 'win32' ? 'loopback' : undefined });
   });
   ```

   On Windows, `'loopback'` adds system audio. Linux system audio is more limited (section 11).
2. **Stream and crop in the recorder window.** Call `getDisplayMedia`, read frames from the video track, and crop each frame to the selected area by creating a new `VideoFrame` with a `visibleRect`. H.264 needs even width and height, so round the area down to even numbers.
3. **Encode with hardware.** Configure `VideoEncoder` for H.264 with `hardwareAcceleration: 'prefer-hardware'`, and fall back to software if `VideoEncoder.isConfigSupported()` says no. Mediabunny can take the track and handle much of this; check its docs for the current API.
4. **Write as you go.** Send encoded chunks to main over IPC (they're small) and append them to a file stream. Never collect a recording in memory.
5. **Keep it running while hidden.** Set `backgroundThrottling: false` on the recorder window only. Every other window keeps throttling on.
6. **Extras.** Microphone via `getUserMedia({ audio })` mixed with system audio using Web Audio; webcam bubble as a small always-on-top window showing `getUserMedia({ video })`; click highlights as a click-through transparent window.
7. **Clean up.** Stop every track, close the encoder, destroy the recorder window, then open the result.

Grant media permissions only to the recorder window: `session.setPermissionRequestHandler` should allow `media` when the request comes from your recorder page, and deny everything else.

## 10. OCR, GIFs, images, history

| Feature | Approach |
| --- | --- |
| OCR | `tesseract.js` in a utility process. Ship the English data file, download other languages on first use, and exit the process after 30 s idle. |
| Image encoding | `sharp` in a utility process: PNG, JPEG, WebP, AVIF, quality, 1× downscale and thumbnails. |
| GIF export | Decode the MP4 frame by frame and feed `gifenc` in a worker, writing as it goes. |
| Scroll capture | Start with manual scrolling: grab frames, match the overlap in a worker, keep only the new strip from each frame. Add automatic scrolling later with an input-automation package (check its licence). |
| History | Files plus a JSON index on disk; thumbnails written at save time. The history window virtualises its list and loads images lazily. |
| Upload | Stream files from disk with `fetch` or `net.request`. Keep upload keys in the OS keychain through `safeStorage`, not in plain settings. |

```
// a utility process that exits when idle
let image: UtilityProcess | null = null;
let idleTimer: NodeJS.Timeout | undefined;

function imageWorker() {
  image ??= utilityProcess.fork(imageWorkerPath).once('exit', () => (image = null));
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => image?.kill(), 30_000);   // one-shot, not an interval
  return image;
}
```

## 11. Linux and Wayland

Plan Linux around two session types. Check `process.env.XDG_SESSION_TYPE` at startup.

|  | X11 | Wayland |
| --- | --- | --- |
| Screen grab | `node-screenshots`, same flow as Windows. | `desktopCapturer`, which goes through the desktop's screen-share service (PipeWire) and may show a system picker. Test what your capture package supports here. |
| Freeze-and-select overlay | Works as on Windows. | Take the grab first, then show your overlay full-screen with the image. Exact window placement is limited by the compositor. |
| Global hotkeys | `globalShortcut` works. | Often limited. Recent Electron versions can use the desktop's global-shortcut service (check the current docs). Always offer the fallback: tell users to bind `myapp --capture` in their desktop's keyboard settings. |
| System audio | Not covered by Electron's loopback option. Offer microphone recording everywhere and system audio where the desktop exposes a monitor device. |  |

Electron's Wayland support changes between versions. Test on GNOME and KDE before each release.

## 12. Security, packaging, updates

- **Window defaults.** `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, a strict Content-Security-Policy in every HTML file, and no remote content.
- **Fuses.** With `@electron/fuses`, turn off RunAsNode, the `NODE_OPTIONS` variable and the inspector arguments, and turn on ASAR integrity checks and only-load-from-ASAR.
- **Native modules in ASAR.** Native `.node` files can't load from inside the archive. In electron-builder, set `asarUnpack` for `**/*.node` and for sharp's library folders.
- **Targets.** Windows: NSIS installer, x64 and arm64 if your packages ship both. Linux: AppImage plus deb and rpm.
- **Updates.** electron-updater against GitHub Releases, checked once a day, with an opt-in beta channel.
- **Code signing.** Sign Windows builds, or SmartScreen will warn users.

## 13. Budgets and tests

These are starting targets. Measure your own baseline on real hardware and tighten from there.

| Metric | Target | Measured with |
| --- | --- | --- |
| Idle CPU over 10 min | ≈ 0% average | `app.getAppMetrics()` CPU per process |
| Idle processes | main + Chromium helpers, no renderers | `app.getAppMetrics()` process types |
| Back to idle after closing a window | \< 30 s | Renderer and utility process count back to baseline |
| Hotkey → overlay, Instant capture on | \< 150 ms | Timestamp in main → first-paint message |
| Hotkey → overlay, Low memory | \< 500 ms | Same |
| Memory after 50 captures | ≈ idle baseline | No upward trend |
| Drawing a long pencil stroke | frames \< 16 ms | DevTools Performance panel |

- Add a hidden debug panel that shows `app.getAppMetrics()` and `process.memoryUsage()`.
- In CI, use Playwright's Electron support: launch the app, run 50 captures, close everything, wait, then assert process count and memory against the budget.
- Unit-test the canvas engine (hit testing, undo, serialisation) with Vitest. It has no UI framework imports, so this is easy.
- On each OS, check private (unique) memory in Task Manager or Process Explorer on Windows and `smem` on Linux, not just the total.

## 14. Mistakes to avoid

Hiding windows instead of destroying them.

Sending screenshots as base64 data URLs over IPC.

Encoding PNG just to display the overlay.

Re-rendering React on every pointer move.

Pixel loops on the CPU for blur and pixelate.

Loading sharp, tesseract.js or other large modules in main.

Polling timers in main (clipboard, displays, updates).

Keeping the recorder, OCR or image workers alive “just in case”.

Holding a recording in memory instead of writing it as it goes.

Turning off hardware acceleration to save memory. Canvas, WebGL and video encoding then fall back to the CPU.

## 15. Build order

Each step is usable on its own, and each one keeps the budgets from section 13 green before moving on.

1. **Skeleton.** Tray, one hotkey, single-instance lock, settings file, budget test in CI.
2. **Capture.** Grab displays, overlay per display, drag to select, copy and save. Low memory mode only.
3. **Annotation engine.** Layers, select/move, arrow, rectangle, pencil, text, undo/redo.
4. **After the capture.** Floating preview, history, pin to screen.
5. **Editor window.** The same engine in a resizable window, plus crop and project files.
6. **More tools.** Censor (WebGL), highlight, number, measure, stamp, colour picker, beautify.
7. **Recording.** MP4 first, then microphone, webcam, clicks, GIF export.
8. **OCR and upload.**
9. **Scroll capture.**
10. **Polish.** Instant capture mode, translations, Wayland testing, signing and auto-update.

## 16. Licence and later options

macshot is GPLv3. If you port its code or assets, your app must be GPLv3 too. Building your own implementation from its feature list avoids that; don't reuse its name, logo or artwork.

If measurements later show one area is too slow or heavy, replace just that piece with a dedicated native module, or move the whole app to Tauri once you know the codebase well. Starting in TypeScript doesn't lock you out of either.

This guide describes architecture and approaches; it was not benchmarked. Electron APIs, package APIs and Wayland support change between releases, so check each one's current docs before relying on it.