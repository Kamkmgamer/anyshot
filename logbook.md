# logbook

## Session

- Box: boxes.dev devbox `8ad08f92-796a-4dd0-88e1-f8dc32f9d8a2` (`default-box-fork-af8c92cf4263`), project `55820d6f-3b36-4755-a698-99a26f8ca460`, checkout `/home/boxes/repos/anyshot`.
- On-box implementation thread: `ph78d3n1dyfse7gztvadjcgzxx8jhnec`.
- Branch `feat/v1`. To resume: read this logbook first, then continue from the "Next:" line below.

**Next:** step 2/3 in progress. Main capture backend (`src/main/capture/*`, `deliver.ts`, `clipboard.ts`), engine (`src/engine/*`), export worker and shared toolbar UI are written. `src/windows/overlay/main.tsx` is a placeholder. Exact next action: write the overlay controller in `main.tsx` (boot from `overlay:init`, fetch `/@frame/<id>`, drag-select/resize/move, toolbars, finish → `exportImage` → `capture:deliver`), add the `capture:deliver`/`capture:to-editor` handlers in main, then e2e for capture+copy+save.

## Status (v1 build order)

| Step | State | Notes |
| --- | --- | --- |
| 1 Skeleton | done | tray, hotkeys, single instance + argv, atomic settings, `app://`, typed IPC, Biome, Vitest, Playwright idle budget |
| 2 Capture | partial | backend + deliver done; overlay controller pending |
| 3 Annotation engine | partial | model, history, shapes, render, GL effects, view written; tests pending |
| 4 After capture | pending | |
| 5 Editor | pending | |
| 6 More tools | pending | |
| 7 Recording | pending | |
| 8 OCR + uploads | pending | |
| 9 Scroll capture | pending | |
| 10 Polish | pending | |

## 2026-11-19 - step 1 skeleton

- Stack: Electron 45.4.1 (Chromium 156), electron-vite 6 + Vite 8 (Rolldown), TypeScript 7.0.2 (native `tsc`), Biome 2.6, Vitest 5, Playwright 1.65, bun 1.4.4.
- Decision: the default session (protocol handler, permission handlers) is configured lazily right before the first window. Touching `session.defaultSession` at startup makes Chromium pre-spawn a spare renderer, which breaks "no renderer at idle". Measured under Xvfb: eager = Browser+GPU+Network+Tab, lazy = Browser+GPU+Network. Tradeoff: the first window after launch starts a cold renderer.
- Decision: one generic preload (`window.anyshot.invoke/on`) instead of one per window type. The channel table in `src/shared/ipc.ts` lists which window kinds may call each channel; main checks the sender frame origin (`app://local/`) and the window kind on every call. One tiny preload is simpler than nine near-identical ones and the per-kind check gives the same isolation.
- Decision: hand-rolled schema DSL (`src/shared/schema.ts`) for settings instead of zod or electron-store; ~80 lines, types inferred, parse never throws, invalid fields fall back per field.
- Default hotkeys use Alt+Shift (X area, F screen, T OCR, R record, H history) to avoid stealing common Ctrl+Shift app shortcuts. Failed registrations are logged; Linux users can bind `anyshot --capture` etc. instead.
- Tests drive main through `globalThis.__anyshot`, installed only when `ANYSHOT_TEST=1`.
