# logbook

## Session

- Box: boxes.dev devbox `8ad08f92-796a-4dd0-88e1-f8dc32f9d8a2` (`default-box-fork-af8c92cf4263`), project `55820d6f-3b36-4755-a698-99a26f8ca460`, checkout `/home/boxes/repos/anyshot`.
- On-box implementation thread: `ph78d3n1dyfse7gztvadjcgzxx8jhnec`.
- Branch `feat/v1`. To resume: read this logbook first, then continue from the "Next:" line below.

**Next:** step 9 (scroll capture). Exact next action: write the stitch algorithm as a pure module `src/shared/stitch.ts` (find vertical overlap between consecutive frames by comparing row hashes/diffs, ignore fixed header/footer rows, append only new rows, cap at `scroll.maxHeight`) with Vitest tests, then `src/main/scroll.ts` + `src/windows/scroll/` (small visible HUD outside the region with Stop/Cancel, `getDisplayMedia` stream sampled ~8 fps, crop, stitch in `src/workers/stitch.worker.ts`, finish → encode PNG → `capture:deliver`), e2e scrolling the fixture.

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
| 9 Scroll capture | pending | |
| 10 Polish | pending | |

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
