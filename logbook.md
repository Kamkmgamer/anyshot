# logbook

## Session

- Box: boxes.dev devbox `8ad08f92-796a-4dd0-88e1-f8dc32f9d8a2` (`default-box-fork-af8c92cf4263`), project `55820d6f-3b36-4755-a698-99a26f8ca460`, checkout `/home/boxes/repos/anyshot`.
- On-box implementation thread: `ph78d3n1dyfse7gztvadjcgzxx8jhnec`.
- Branch `feat/v1`. To resume: read this logbook first, then continue from the "Next:" line below.

**Next:** step 5 (editor) — editor window, project files (`src/shared/project.ts`, tested) and history write-back are written but the editor has no e2e yet. Exact next action: add `tests/e2e/editor.spec.ts` (overlay → E opens editor with annotations carried over; crop + undo; Ctrl+S saves the cropped size; save/open `.anyshot` round-trip via `globalThis.__anyshot`), fix what it finds, then mark step 5 done.

## Status (v1 build order)

| Step | State | Notes |
| --- | --- | --- |
| 1 Skeleton | done | tray, hotkeys, single instance + argv, atomic settings, `app://`, typed IPC, Biome, Vitest, Playwright idle budget |
| 2 Capture | done | node-screenshots + desktopCapturer fallback, overlay per display, select/resize/move, copy/save, e2e |
| 3 Annotation engine | done | plain TS in `src/engine`, 3 canvas layers, rAF + coalesced input, all tools, change-list undo, Vitest |
| 4 After capture | done | history store + window (lazy grid), floating preview (one shared window), pins, e2e |
| 5 Editor | partial | window, zoom/fit, crop (undoable), project files, history write-back written; e2e pending |
| 6 More tools | pending | |
| 7 Recording | pending | |
| 8 OCR + uploads | pending | |
| 9 Scroll capture | pending | |
| 10 Polish | pending | |

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
