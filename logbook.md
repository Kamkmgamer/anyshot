# logbook

## Session

- Box: boxes.dev devbox `8ad08f92-796a-4dd0-88e1-f8dc32f9d8a2` (`default-box-fork-af8c92cf4263`), project `55820d6f-3b36-4755-a698-99a26f8ca460`, checkout `/home/boxes/repos/anyshot`.
- On-box implementation thread: `ph78d3n1dyfse7gztvadjcgzxx8jhnec`.
- Branch `feat/v1`. To resume: read this logbook first, then continue from the "Next:" line below.

**Next:** v1 complete as listed below; draft PR next (supervisor). Follow-ups: run on real Windows (mixed DPI, tray, shortcuts, H.264 hardware encode, loopback audio, NSIS, signing); test Wayland (GNOME, KDE); recording HUD; auto-redact; QR detection; editor flip and image layers; auto-update.

## Status (v1 build order)

| Step | State | Notes |
| --- | --- | --- |
| 1 Skeleton | done | tray, hotkeys, single instance + argv, atomic settings, `app://`, typed IPC, Biome, Vitest, Playwright idle budget |
| 2 Capture | done | node-screenshots + desktopCapturer fallback, overlay per display, select/resize/move, copy/save, e2e |
| 3 Annotation engine | done | plain TS in `src/engine`, 3 canvas layers, rAF + coalesced input, all tools, change-list undo, Vitest |
| 4 After capture | done | history store + window (lazy grid), floating preview (one shared window), pins, e2e |
| 5 Editor | done | window, zoom/fit, undoable crop, `.anyshot` projects, history write-back, e2e. Flip and "add capture" layers not done |
| 6 More tools | done | censor (WebGL pixelate/blur, solid), spotlight, magnify, measure, stamp, colour picker, invert, adjust (shader + presets), beautify. Auto-redact (OCR/PII) pending |
| 7 Recording | done | MP4 (H.264, VP9/WebM fallback) via getDisplayMedia + Mediabunny streamed to disk, mic (untested here), GIF via intermediate MP4 + gifenc worker, e2e. No HUD/webcam/click highlights |
| 8 OCR + uploads | done | OCR (idle-exiting utilityProcess, offline English), uploads: provider interface, HTTP multipart + S3 SigV4, keys via safeStorage; unit + e2e |
| 9 Scroll capture | done | manual scrolling, HUD outside the region, stream sampled ~7 fps, stitch worker, quick action; unit + e2e (exact 600×1060). No auto-scroll/horizontal |
| 10 Polish | partial | settings window, instant capture, electron-builder + fuses, README done. No auto-update, signing, translations |

## 2026-11-19 - flaky after-capture e2e fixed in the app

- Independent verification of `c8fe54b` found `after-capture.spec.ts` flaky (pin not closing on Esc; history count wrong). Baseline here with `--repeat-each=10`: 5/10 failures of the pin test.
- Pin root cause: the window was shown on `ready-to-show` (first paint of an empty page) while its Esc handler was attached only after the `pin:init` round trip and the first render, so a key pressed as the pin appeared was lost. Users could hit it too. Fix: keys are handled from the moment the script runs, and main shows the pin only when its image has loaded (`pin:ready`), so it never appears blank or deaf.
- History root cause: the window listed entries once when it opened; a capture still being delivered (or finished later) never appeared. Fix: main sends `history:changed` after every index write and open history windows reload. New e2e check: a capture made while History is open appears without reopening it.
- Result: `--repeat-each=10` of after-capture → 40/40 twice; full e2e twice → 23 passed, 1 skipped each.

## 2026-11-19 - final verification

- On `1181c4e` under Xvfb (1280×800): `bun run format:check`, `lint`, `typecheck`, `test` (53 unit tests), `build` all pass; `xvfb-run -a bun run test:e2e` → 23 passed, 1 skipped (the opt-in screenshot generator), 1 worker. The next commit only regenerates `docs/screenshots/` and this logbook.
- Budgets measured under Xvfb: idle = Browser + GPU + network service, no renderer; idle main CPU < 2 % over 5 s; renderers back to 0 after closing overlays, previews, pins and the recorder; hotkey → overlay 100–147 ms (low memory), 64–84 ms (instant capture); OCR process exits after its idle timeout.
- Not verifiable here: anything Windows-native, Wayland, real GPUs (WebGL is blocklisted under Xvfb, so the shaders run on SwiftShader or fall back to Canvas 2D), multi-monitor and mixed DPI.

## 2026-11-19 - step 10 packaging

- `electron-builder.yml`: NSIS (x64) for Windows; AppImage, deb, rpm (x64) for Linux; `asarUnpack: **/*.node`; only the compact English OCR model ships; tray/app icons as extra resources.
- Decision: fuses through electron-builder's built-in `electronFuses` (RunAsNode off, NODE_OPTIONS and inspector args off, cookie encryption on, ASAR integrity on, only load from ASAR, no extra file:// privileges) instead of an afterPack hook with `@electron/fuses` (removed).
- Verified locally: `bun run dist:dir` builds `dist/linux-unpacked` (338 MB unpacked); `@electron/fuses read` shows the fuses; the fused binary started with `--capture` under Xvfb shows the overlay (checked with an X screen grab). Playwright can't attach to the fused build (inspector disabled), so packaged e2e is a smoke test only.
- Found while checking the real X screen: `useStore` subscribed in `useEffect`, after the first render, so state set right after `render()` was lost — the overlay's instructions never showed. The hook now re-reads the store when it subscribes; covered by an e2e assertion.
- Not done: code signing, auto-update (electron-updater), arm64 builds, rpm built here (needs rpmbuild).

## 2026-11-19 - step 10 instant capture

- With instant capture on, one hidden overlay is loaded at startup and after every capture. Its `overlay:init` stays pending until a capture claims the window for the display under the pointer, so the renderer start-up is off the hotkey path. Idle cost: one renderer, no CPU.
- Measured under Xvfb: hotkey → overlay shown 68–92 ms (instant) vs 91–119 ms (low memory). The gap is small here because Xvfb renderers start fast; expect a larger gain on real Windows hardware.

## 2026-11-19 - step 10 settings

- Settings window covers General, Capture, Output, Shortcuts (click and press keys; validated against the accelerator pattern), Tools (toolbar visibility), Recording, Uploads, About. Every change goes through `settings:patch` (validated, written atomically) and is broadcast to open windows.
- Secrets are write-only from the window: it can set a value and see which keys exist, never read one.
- Decision: on Linux without a keyring (Electron reports the `basic_text` backend as unavailable) anyshot refuses to store credentials unless the user turns on "Store credentials without a keyring (obfuscated only)", which calls `safeStorage.setUsePlainTextEncryption(true)`. Safer default than silently obfuscating.
- Launch at login: Electron login items on Windows; an XDG autostart `.desktop` entry on Linux (uses `$APPIMAGE` when running as an AppImage).

## 2026-11-19 - step 9 scroll capture

- The HUD window sits just outside the selected region (below, else above) and is shown without focus, so the page being scrolled keeps the wheel. Frames come from `getDisplayMedia` via a muted `<video>`, cropped on an OffscreenCanvas every 150 ms and stitched in `stitch.worker.ts`; the worker also encodes the PNG and thumbnail at the end.
- `src/main/display-media.ts` now owns `setDisplayMediaRequestHandler` for both recorder and scroll capture.
- Not done: auto-scroll (needs an input-automation package), horizontal scrolling, live preview of the stitched image.

## 2026-11-19 - step 8 uploads

- Providers (`src/main/upload-providers.ts`, no Electron imports): generic HTTP multipart POST with the URL read from a JSON path (covers imgbb/imgur-style APIs and self-hosted endpoints) and S3-compatible PUT (path-style, works with AWS, R2, MinIO, B2, Spaces).
- SigV4 is ~60 lines on `node:crypto` (`src/main/sigv4.ts`) instead of the AWS SDK or aws4fetch; it reproduces AWS's published "get-vanilla" signature exactly.
- Credentials live in `secrets.bin`, encrypted with `safeStorage`, never in settings and never sent to windows (windows can only set them and see which keys exist). If no keychain is available anyshot refuses to store them; on Linux the `basic_text` backend is reported to the settings window so it can warn.
- Google Drive (OAuth) is not implemented.

## 2026-11-19 - step 8 OCR

- tesseract.js runs in a `utilityProcess` forked on first use and killed by a one-shot 30 s idle timer (tests shorten it with `ANYSHOT_OCR_IDLE_MS`). English data (`@tesseract.js-data/eng`, 4.0.0 best_int, ~3 MB gzipped, MIT) ships with the app so OCR works offline; packaging should exclude the unused 4.0.0 folder.
- Under Xvfb the fixture's report text is recognised exactly ("Quarterly report", "Revenue grew 18% …").
- Rolldown injects its own `require` shim into ESM output, so a local `const require = createRequire(...)` breaks the bundle; use another name.
- e2e harness now captures main-process output (`ctx.mainLog`) for diagnosing failures.
- Not done: QR code detection, other OCR languages, translation.

## 2026-11-19 - step 7 recording

- Hidden recorder window (`backgroundThrottling: false` only there). Main answers `getDisplayMedia` through `setDisplayMediaRequestHandler` with the overlay's display (loopback audio on Windows). Media permissions are granted only to recorder/scroll windows; everything else is denied.
- Mediabunny `MediaStreamVideoTrackSource` crops in the encoder pipeline (`transform.crop`); the crop is scaled from display pixels to the stream's actual size. Codec: first encodable of H.264 → VP9 → VP8 (MP4 for H.264, WebM otherwise). Under Xvfb H.264 encodes in software: 400×200, 15 fps, 2.4 s → 36 frames.
- `StreamTarget` chunks (1 MiB) go to main and are written at their file offsets (`fd.write(data, position)`), so a recording is never held in memory and the MP4 index can be patched at the end.
- GIF: record an intermediate MP4 to temp, read it back through a Range-capable `app://local/@recording/` route (only that file, only while recording), decode with `CanvasSink`, encode each frame in a gifenc worker and stream bytes to disk; the intermediate file is deleted.
- Mediabunny creates a `blob:` worker (Chromium exposes `MediaStreamTrackProcessor` only in workers), so the recorder page alone allows `worker-src blob:`.
- The recorder bundle is ~1.2 MB (Mediabunny); it loads only when recording starts.
- Not done: recording HUD with pause/stop (tray has Stop), webcam bubble, click highlights, keystrokes, system audio on Linux.

## 2026-11-19 - step 6 more tools

- Effects live in `Doc.effects` and change through the change list; Adjust sliders preview through `CanvasView.preview()` and commit once on release, so a drag is a single undo step.
- Colour adjustments run in the WebGL shader; if WebGL is unavailable (e.g. some workers or GPU blocklists) they fall back to a Canvas 2D filter string (no sharpness) instead of silently doing nothing.
- Beautify renders only into the output (copy/save/pin), not live in the overlay.
- Not done: auto-redaction (needs OCR), sepia/chrome presets, magnify/measure options beyond zoom.

## 2026-11-19 - docs screenshots

- `docs/screenshots/overlay.png` and `editor.png` are produced by `ANYSHOT_SCREENSHOTS=1 xvfb-run -a bun run test:e2e tests/e2e/screenshots.spec.ts` (skipped otherwise) against the fixture desktop.
- Making them found a real bug: the text box focused one frame late, so fast typing went to overlay shortcuts (Enter ran the quick action). It now focuses synchronously.

## 2026-11-19 - step 5 editor

- Crop is non-destructive: `Doc.crop` changes through the change list, so it undoes in one step and annotations keep image coordinates. The view clips and translates the stage.
- `.anyshot` = `ANYSHOT1` + uint32 JSON length + JSON (doc + image info) + PNG bytes. One file, no base64.
- Copy/save/pin from an editor update one history entry (the first delivery creates it, later ones replace its image) instead of adding a new entry each time, and never show the floating preview.
- Closing a dirty editor asks Discard/Cancel. Quitting the app skips that prompt; otherwise the blocking dialog stalls quit (found by e2e teardown hanging).
- Not done: flip, "add capture" layers, pasting images as layers.

## 2026-11-19 - step 4 after capture

- History: `userData/history/<id>.png` + `<id>.thumb.webp` (written by the export worker at capture time) + `index.json` written atomically; index updates are serialised. New entries are retained until their consumer (preview, pin) releases them, so history size 0 still works.
- Floating previews share one unfocusable, transparent window in the configured corner; it is destroyed when the last preview goes. Drag-out uses `webContents.startDrag`.
- Pins are one small window each (they live as long as the user wants, so sharing a renderer would tie their lifetimes together). Moved with pointer deltas over IPC; wheel zoom resizes the window.
- A capture started while the previous one is still being delivered (overlays hidden, encoding) now waits for it instead of being dropped.
- History window: CSS grid with `content-visibility: auto` and `loading="lazy"` thumbnails served from `app://local/@history/<id>/thumb`; no full images are decoded.
- Paths are resolved from `app.getAppPath()`: Rolldown moved `paths.ts` into a chunk, which broke `import.meta.dirname`-relative paths.
- Biome a11y rules `noStaticElementInteractions` and `useKeyWithClickEvents` are off: the overlay, previews and pins are pointer-first surfaces with window-level keyboard shortcuts.

## 2026-11-19 - step 3 annotation engine

- `src/engine` has no UI imports (guarded by a unit test). `DocStore` holds a serialisable `Doc` and a change list (`add`/`remove`/`update`/`effects`/`crop`/`batch`, each with an exact inverse). `CanvasView` owns the three layers; the committed layer redraws only on doc changes, the interaction layer once per animation frame while dragging. Moved annotations are hidden on the committed layer during the drag.
- All step 6 tools (censor, spotlight, magnify, stamp, picker, measure) were cheap to add alongside the core ones, so they exist already; step 6 adds effects UI (beautify/adjust/invert) and polish.
- Tests get their own `tsconfig.test.json` (DOM + Node) so main code still can't see DOM types.
- Spotlight with one hole uses an even-odd path; several holes use a scratch layer with `destination-out`.

## 2026-11-19 - step 2 capture

- Grab order: display under the pointer first; each display is grabbed before its overlay window exists, so overlays never appear in other grabs. Frames go to windows as raw RGBA over `app://local/@frame/<id>`; the window calls `frame:release` once the pixels are on its canvas.
- Measured under Xvfb (1280×800, low-memory mode): hotkey → overlay painted and shown 91–119 ms (budget 500 ms). Renderer count returns to 0 after Esc; no frames left in main.
- Decision (deviation): PNG/JPEG/WebP encoding uses Chromium's encoders (`OffscreenCanvas.convertToBlob`) inside a per-window export worker instead of sharp in a utility process. The worker already has the pixels and replays annotations, so nothing crosses a process boundary before encoding, and we avoid shipping libvips (~20 MB) and its native-module packaging. Tradeoff: no AVIF and no PNG compression-level control.
- Decision: overlay windows are opaque (`transparent: false`) since they paint the frozen screenshot anyway; cheaper and avoids Linux compositor issues. On Linux full screen is set only when the overlay is shown, because a full-screen window is shown immediately (it flashed black before the screenshot was painted).
- Electron 45's clipboard is the new async ClipboardItem API (`clipboard.write([new ClipboardItem({'image/png': blob})])`); wrapped in `src/main/clipboard.ts`.
- Censor and colour adjustments are WebGL fragment shaders (`src/engine/gl.ts`) with a Canvas 2D fallback when WebGL is unavailable.
- Xvfb's root window stays black (`xsetroot` has no effect here), so e2e tests open a full-screen fixture window with known colours and check exact pixels in the clipboard and saved files, for both capture backends.

## 2026-11-19 - step 1 skeleton

- Stack: Electron 45.4.1 (Chromium 156), electron-vite 6 + Vite 8 (Rolldown), TypeScript 7.0.2 (native `tsc`), Biome 2.6, Vitest 5, Playwright 1.65, bun 1.4.4.
- Decision: the default session (protocol handler, permission handlers) is configured lazily right before the first window. Touching `session.defaultSession` at startup makes Chromium pre-spawn a spare renderer, which breaks "no renderer at idle". Measured under Xvfb: eager = Browser+GPU+Network+Tab, lazy = Browser+GPU+Network. Tradeoff: the first window after launch starts a cold renderer.
- Decision: one generic preload (`window.anyshot.invoke/on`) instead of one per window type. The channel table in `src/shared/ipc.ts` lists which window kinds may call each channel; main checks the sender frame origin (`app://local/`) and the window kind on every call. One tiny preload is simpler than nine near-identical ones and the per-kind check gives the same isolation.
- Decision: hand-rolled schema DSL (`src/shared/schema.ts`) for settings instead of zod or electron-store; ~80 lines, types inferred, parse never throws, invalid fields fall back per field.
- Default hotkeys use Alt+Shift (X area, F screen, T OCR, R record, H history) to avoid stealing common Ctrl+Shift app shortcuts. Failed registrations are logged; Linux users can bind `anyshot --capture` etc. instead.
- Tests drive main through `globalThis.__anyshot`, installed only when `ANYSHOT_TEST=1`.
