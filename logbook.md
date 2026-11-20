# logbook

## Session

- Box: boxes.dev devbox `8ad08f92-796a-4dd0-88e1-f8dc32f9d8a2` (`default-box-fork-af8c92cf4263`), project `55820d6f-3b36-4755-a698-99a26f8ca460`, checkout `/home/boxes/repos/anyshot`.
- On-box implementation thread: `ph73jdn3ekr9hqqj5ngyya8s4x8jgfvd` (v1 used `ph78d3n1dyfse7gztvadjcgzxx8jhnec`).
- Session box `98774d41-e95f-40e0-bf34-7b9c66510d54` (`default-box-fork-7cebc354a22b`), checkout `/home/boxes/repos/anyshot`. PRs #7–#11 are merged. To resume: read this logbook first, then continue from the "Next:" line below.

## 2026-11-20 - releases only by hand (branch `ci/manual-releases`)

- The user decides when a release goes out; merging to main no longer releases. `release.yml` runs on `workflow_dispatch` (inputs `bump`: patch/minor/major, default patch; `draft`: boolean, default false) and on `v*` tag pushes; the `push: branches: [main]` trigger is gone. A manual run publishes (before, it always made a draft) unless `draft` is set; publishing is refused from any ref but main, drafts work from any branch. Version: package.json's if newer than every release, else the latest release bumped by `bump`. Release notes still come from generate-notes, so they now list every PR since the previous release. README has a Releasing section.
- Checked: actionlint clean; the version step run against a fake `gh` (patch 0.1.7→0.1.8, minor→0.2.0, major→1.0.0, draft on a branch, publish on a branch refused, bumped package.json, no releases yet); a real draft run from the branch (minor, draft), whose draft was then deleted.
- Rule from the user (also in the global agent instructions): never mention the logbook in PR text or release notes/titles, and no logbook-only PRs.

**Next:** merge; releases from now on via Actions → Release → Run workflow on main.

## 2026-11-20 - picker toast, Open with, Beautify None, editor minimum size (branch `feat/polish-picker-openwith-beautify-minsize`)

- **Colour picker toast:** picking a colour shows "Colour set to #RRGGBB"; Shift+click shows "Copied #RRGGBB to the clipboard" once the copy succeeded (or "Could not copy"). In the editor and in the capture overlay (whose `toast` was never set before); both go away after 2.5 s. Unit (`pickedColorMessage`) and e2e (editor: set, auto-hide, Shift+click and the clipboard text; overlay).
- **Open with:** `parseCli` opens a bare image or project argument (png, jpg, jpeg, webp, gif, bmp, anyshot), as a path (Windows passes `anyshot.exe "%1"`) or a `file://` URL (Linux desktop entries use `%U`); the first argument (the executable) and other bare words are ignored. Works for a cold start and for a running app (second instance). Windows: `resources/installer.nsh` (NSIS `customInstall`/`customUnInstall`) writes an `anyshot.Image` ProgID, the types' `OpenWithProgids` and `Applications\anyshot.exe` with `SupportedTypes`, without changing any type's default app (electron-builder's `fileAssociations` would make anyshot the default), and removes them on uninstall. Linux: `linux.mimeTypes` puts `MimeType=image/png;image/jpeg;image/webp;image/gif;image/bmp;` in the desktop entry (checked in a built .deb). The NSIS build needs wine on Linux, so a new workflow (`installer.yml`, Windows runner, on PRs touching the installer config) builds the installer, installs it silently, checks the registry and uninstalls. Unit and e2e (path, file URL, second instance).
- **Beautify:** the checkbox is gone. The background row starts with a struck-through "No background" tile; picking it removes the frame, picking a gradient adds it. Only the chosen tile is highlighted (before, a gradient stayed highlighted while Beautify was off), the header shows Off/On, and the sliders are disabled until a background is picked. e2e covers the states, the frame and the copy size after removing it. Screenshots `beautify-off.png`, `beautify-on.png`.
- **Editor minimum size:** the header (title, zoom, save, Replace, pin, Done) and the tool strip are single rows, and the window's fixed minimum (640) was narrower than them, so Done was cut off. Also, the editor's grid column grew to the header's min-content, so the title never shrank. Now the column is `minmax(0, 1fr)`, only the title shrinks (to 80 px), and the page measures what its rows need (`min-size.ts`, re-measured when the toolbars change) and sends it over `editor:min-size`; main makes it the window's minimum and grows the window if needed, within the work area (`growToMinimum`). New editors open at least 820 wide. e2e: a history edit (the widest header) asked to be 420 wide stays wide enough that Done and the last tool button are inside the page. Screenshot `editor-narrow.png`.
- PR #12 CI: the new Windows installer job passed on a real Windows runner (installed, registry checked, uninstalled clean). The Windows unit job failed on the `file://` test (a POSIX URL is not a Windows path); the test now builds the URL with `pathToFileURL` for the platform.
- CodeRabbit round 1 on PR #12 (4 findings: the `file://` test, already fixed, and 3 more, all fixed): the measurement skips absolutely positioned children, so opening the Save options menu no longer widens the minimum (e2e; fails without the fix); the work-area cap now includes the window frame (outer minimum ≤ work area); main keeps each editor's measured toolbar size and reapplies it when the window moves or displays change (no renderer round trip). The display move can't be exercised under Xvfb (one screen).

**Next:** PR review (CodeRabbit), the Windows installer workflow on the PR, merge (one release). Then the user checks on Windows: right-click an image → Open with → anyshot opens it (also while anyshot runs); the default image app is unchanged; the editor can't be made too narrow for Done.

## 2026-11-20 - wrap-up: PRs #7–#10 merged

- Merged: #7 scroll capture (release 0.1.3), #8 popovers (0.1.4), #10 auto-update (0.1.5, the first release with `latest.yml`, `latest-linux.yml` and blockmaps), #9 text styles (0.1.6). Each had 2–3 CodeRabbit rounds; every finding was fixed.
- Verified on the box: format, lint, typecheck, unit tests, build, and the full e2e suite under Xvfb on every branch (last: 75 passed, 8 skipped = the screenshot generator); the scroll fix against real wheel scrolling at 100 % and forced 150 %; a release dry run (deleted draft); a real AppImage self-update against a local feed.
- Not verifiable here: Windows. The NSIS update, DPI scroll capture, and the Windows fonts of the text tool need a real Windows machine.

**Next:** the user checks on Windows: (1) install 0.1.5 (the first release with the updater), start it: it should offer 0.1.6 (or newer); Update downloads, installs silently and restarts on the new version (x64 and, if available, ARM64); (2) scroll capture in a browser and another app, slowly and fast, at 100 % and 150 %, and on a second monitor with different scaling; (3) text styles: each font looks right, and a copied image matches the editor.

## 2026-11-20 - text tool styles (branch `feat/text-styles`)

- Text had one style (semibold sans with an outline). Text annotations now carry a `style` (`font`, `bold`, `italic`, `underline`, `outline`). Older documents and projects without one read as the old look (`DEFAULT_TEXT_STYLE`), and malformed fields fall back field by field. Fonts are system-safe families, each listing the Windows font first, then Linux ones, then the generic family: Sans (Segoe UI), Serif (Georgia), Mono (Consolas), Hand (Segoe Print / Comic Sans MS, `cursive` on Linux).
- One renderer: `drawText` (used by the canvas and the export) builds the font with `textFont(size, style)`, draws the outline only when asked, and draws the underline as a rect under each non-empty line at its measured width. Italic boxes are 0.2 em wider for the lean. e2e: the on-screen layers (image + annotations) and the copied image are compared pixel by pixel: 0 pixels differ by more than 8.
- **Style popover:** the text tool's options row shows a "Text style" button that previews the style ("Aa", font · size) and opens a popover with font, B / I / U / Outline, size (−/+, steps 2/4/8 that retrace each other, presets 16–72) and colour. Its buttons don't take focus, so a text box being typed keeps focus and restyles live; typing continues and Enter places it in the new style. With the select tool, the button also shows for selected text and restyles it, one undo step per change. Choices persist as tool settings (`textFont`, `textBold`, `textItalic`, `textUnderline`, `textOutline`). It closes on a press outside and on Esc, like the other popovers.
- The overlay's floating toolbar measured only itself, so popovers hanging below it could run off the screen. Popovers now open above the bar when there is no room below (`popoverSide`).
- Tests: unit (font string, italic box, old docs, malformed style, `restyle` with unit, size steps, settings defaults, outline and underline drawing calls); e2e (live restyle while typing, saved style, remembered settings, canvas = export pixels, restyling selected text with undo, popovers upwards near the bottom). Screenshot `text-style.png`.
- CodeRabbit round 1 on PR #9 (2 findings, fixed): the edit box previews the outline the canvas draws (`textOutline`, shared; drawn as a ring of text shadows at half the stroke width, because `-webkit-text-stroke` hid the underline in the box) and drops it when Outline is off. With the select tool, the popover and its button show the selected text's own style (the first selected text; size in tool units) and toggle from it, so the first click on Italic for italic text turns it off; for the text tool they show the remembered style. Unit and e2e tests for both.
- CodeRabbit round 2 on PR #9 (2 findings, fixed): Smaller now undoes Larger across band edges too (62 → 66 → 62; unit test over every size), and the canvas = export e2e checks the exported size and buffer length before comparing pixels. Also found while regenerating the screenshot: `-webkit-text-stroke` hid the underline in the edit box, so the outline preview is a ring of text shadows.

Merged as PR #9. **Next:** see the wrap-up above.

## 2026-11-20 - auto-update (branch `feat/auto-update`)

- **electron-updater** (6.8.11) reads `app-update.yml`, which electron-builder now writes from the new `publish:` block (GitHub, this repo, `releaseType: release`). CI still builds with `--publish never` and uploads the files itself. Checked on the box with a Linux build: `latest-linux.yml` lists the AppImage (first, with `blockMapSize`) and the `.deb`; `app-update.yml` points at GitHub; only the deb gets `package-type` (so an AppImage gets `AppImageUpdater`, a deb `DebUpdater`).
- **Windows metadata for both arches:** each NSIS build writes a `latest.yml` with only its own installer. The release workflow keeps both and merges them (`scripts/merge-update-metadata.ts`, dependency-free, unit-tested; the x64 one stays the default `path`). electron-updater picks the file whose name contains `process.arch` (checked in its `findFile`), so ARM64 machines get the `-arm64.exe`. The workflow uploads the `.exe.blockmap`s, `latest.yml` and `latest-linux.yml`, checks each by name, and checks that every unpacked build has `app-update.yml`.
- **Startup check** (`main/update.ts`): 5 s after startup, only when packaged, not under test, and if Settings ▸ General ▸ "Check for updates" (new, on by default) allows. No auto-download. A failed check (offline, rate limit, no release yet) is logged and nothing else. `checkForUpdate` in `shared/update.ts` takes its dependencies, so this is unit-tested without Electron.
- **Update window** (`windows/update`): version, "You have X", up to 5 notes (the release's list items without "by @user in #12" credits or the download table; `shortNotes`), a Release notes link, **Later** / **Update**. Update downloads with a progress bar, then `quitAndInstall(silent, run after)`. A failure shows the reason and "Try again". Self-update: the NSIS install and an AppImage (`APPIMAGE` set). A `.deb` install says so and offers **Download**, which opens the release page. The release notes gained a line about this.
- Tests: unit (notes from GitHub HTML and Markdown, self-update by platform, startup check: offers / disabled / offline / latest, metadata merge). e2e with a fake updater through test hooks: no check when unpackaged, the window's text, notes and links, progress then install, a failed download and Try again, Later, the `.deb` Download, the Settings toggle. Screenshot `update.png`.
- **Release dry run** (manual run on this branch, draft `v0.1.3`, deleted afterwards so a push to main doesn't publish stale metadata): all 8 assets; `latest.yml` lists both installers (x64 default) and their sha512 match the uploaded `.exe`s; `latest-linux.yml` lists the AppImage and the deb.
- **Real AppImage self-update on the box:** two AppImages (0.0.1, 0.0.2) built with a local generic feed. 0.0.1 ran packaged under Xvfb, found 0.0.2, showed the window; a click on Update (xdotool) downloaded it, replaced the AppImage file and relaunched it. This caught a bug the e2e couldn't: `import('electron-updater')` gave `autoUpdater` undefined (CommonJS getter, missed by ESM named imports), so packaged builds logged "updater unavailable" and never checked. Fixed by reading it through the module's `default`; e2e "electron-updater loads in the built main process" fails with the old import. (Differential download fell back to a full one only because the test server had no range requests.)
- CodeRabbit round 1 on PR #10 (1 finding, fixed): install failures after the download (electron-updater emits them instead of throwing, e.g. an AppImage in a folder the user can't write to) now reach the window as an error with Try again; `install()` rejects on the updater's `error`. e2e covers it.

Merged as PR #10 (release 0.1.5 is the first with the updater; 0.1.4 came from PR #8 and has only the four installers). **Next:** after merge the first release with the update files is the one that existing installs can update *to* from the next one (0.1.x installs have no updater yet). The user checks on Windows: install release N, publish N+1, start N: the window appears, and Update installs and restarts.

## 2026-11-20 - popovers close on a press outside them (branch `fix/popover-dismiss`)

- The colour, Adjust and Beautify popovers (overlay and editor) only closed from their own button or Esc. `dismissPopovers` (in `common/popover.ts`, installed by `createAnnotator`, so both windows get it) listens in the capture phase. A press outside the open popover closes it. On the canvas or page the press is swallowed, so it doesn't also draw or start a new selection; on another control (a tool, undo) it closes the popover and still acts. A press inside the popover or on a popover toggle keeps it, so the toggles still toggle. Esc closes the popover first and stops there; the window's own Esc (cancel the capture) waits for the next press. The overlay's and editor's separate Esc branches for popovers are gone.
- Popover buttons carry `aria-haspopup="dialog"` and `aria-expanded` instead of `aria-pressed` (also the marker the dismissal keeps open for). The editor's save menu already closed on outside clicks and Esc.
- Tests: unit `pressOutcome`; e2e for the overlay (a press inside keeps it; a drag on the image closes it without drawing, then draws; Esc closes it and keeps the capture; a second Esc cancels) and the editor (toggle, swap with another popover, another tool closes it and is chosen, a click beside the image, Esc keeps the editor). Both e2e specs fail on main.

- CodeRabbit round 1 on PR #8 (1 finding, fixed): the colour, Adjust and Beautify popovers have `role="dialog"` and a name, matching the `aria-haspopup="dialog"` their buttons announce; e2e finds Adjust by that role.
- CodeRabbit round 2 on PR #8 (1 finding, fixed): popovers handle focus like dialogs. Opened from the keyboard, focus moves to the first control; when one closes with focus inside, focus returns to its button. Opened with the mouse, focus stays where it was, so a text box being typed keeps it (text styles, PR #9). e2e: Enter on Adjust focuses its first preset, Esc returns focus to Adjust.
- CodeRabbit round 3 on PR #8 (1 finding, fixed; the last round): the pending move of focus into a keyboard-opened popover is cancelled by a pointer press, another popover change, or cleanup, so it can't pull focus back after the user clicked elsewhere. CI once failed `instant.spec.ts` with an aborted overlay load (`net::ERR_UNEXPECTED`); it passed 8/8 on the box and on a re-run, so it is a flake unrelated to popovers.

Merged as PR #8. **Next:** PR #9 (text styles) builds on it.

## 2026-11-20 - scroll capture keeps track while scrolling (branch `fix/scroll-hud`)

User report: the output is mostly fine, but even when scrolling very slowly the HUD keeps saying "Lost track · scroll back up a little", scrolling back up doesn't clear it, and only sometimes the pixel count rises.

- **Reproduced under Xvfb** with real wheel scrolling (`xdotool click 5`, one notch every 350–400 ms, pointer over the page): the HUD went to "Lost track" a dozen times in 25 notches. Dumped the sampled frames and replayed them through `Stitcher` offline: about a third of frames returned `null`.
- **Cause 1: sub-pixel scroll offsets.** Wheel scrolling is smooth, so frames land mid-animation at fractional offsets, and anti-aliased edges are drawn differently every ~35 rows. The true shift had a mean row difference of ~0.45 (every other shift ≥ 7), but only 92–93 % of rows matched exactly, under the hard 95 % threshold. Display scaling (125 %, 150 %) puts content at sub-pixel offsets on every scroll, so this is worse on Windows. Now a match needs 85 % of comparable rows, and among the candidates the one with the lowest mean difference wins. Every shift is ranked on a sample of 64 rows first, then the best four are checked on all rows (~10 ms per 600 × 400 frame).
- **Cause 2: the pointer mask.** It was one box around the pointer's last two spots; when the pointer moved, that box covered most of the frame, and rows hidden by it counted as *mismatches*. Now there is one area per spot (`pointerAreas`), and a row the pointer hides is "unknown", which counts neither way.
- **Why it stuck:** shifts were only searched downwards (d ≥ 1). A frame that didn't scroll but changed a little (a hover highlight, a caret) was "lost", and so was any frame after scrolling back up past the last matched frame. Since a lost frame isn't placed, each later frame was compared with an ever older one. Now shifts are signed (0 and upwards too): the stitch tracks where the view is, adds only rows past its end, and scrolling back up re-anchors it.
- **HUD:** state moved to `windows/scroll/status.ts` (`onFrameReply`, `hudLabel`, unit-tested). One missed frame is ignored; "Lost track · scroll back a little" shows after two in a row and clears on the next match. At the height limit it says "Height limit · W × H" instead of a count that silently stops (the worker's progress carries `full`).
- **DPI:** on Windows the pointer is mapped through physical pixels (`screen.dipToScreenPoint` / `dipToScreenRect`), since displays with different scaling don't share one DIP grid; elsewhere DIPs scale from the display's origin (`pointerInCrop`, unit-tested).
- Tests: 6 new unit tests (sub-pixel edges, moving pointer, back up then down, repaint without scrolling, recovery above the last matched frame, `full`), all failing on the old stitcher; HUD and `pointerInCrop` tests. e2e: slow wheel scrolling with a hover-highlighting page and the pointer over it, at 100 % and at `--force-device-scale-factor=1.5`: no "Lost track" ever shown, and the image height is the first view plus the distance scrolled (±2 px). Both fail on main.

- CodeRabbit round 1 on PR #7 (1 finding, fixed): the e2e's HUD polling loop stops in a `finally`, and a closed page ends it, so a failing step can't leave it running into the next test.
- CI on that commit hit a race in `settings.spec.ts` (unrelated to this change): the Tools reset test read `settings.json` before `tools` was written and threw. Missing `tools` now reads as the defaults, so the poll waits.

Merged as PR #7. **Next:** the user checks scroll capture on Windows at 100 % and 150 %, in a browser and another app.

## 2026-11-20 - releases from main (branch `ci/release-on-main`)

- Every push to `main` now builds and publishes a release (docs-only pushes are skipped). A `version` job picks the version: package.json's if it is newer than every published release and not released yet, else the next patch after the latest release (drafts don't count). The build jobs stamp it into package.json before packaging, so the installers carry it. A `vX.Y.Z` tag still publishes exactly that version (must match package.json); manual runs still make drafts. The first push publishes the existing `v0.1.0` draft, refreshed from main. Why releases didn't show: `v0.1.0` was a draft, which GitHub doesn't list in the sidebar.
- CodeRabbit on PR #5: fixed: list every published release (`gh api --paginate`, not `--limit 100`), and accept only `X.Y.Z` versions (package.json and tags must be X.Y.Z; other tags such as `v0.2.0-rc.1` are ignored when picking the next version, so bash arithmetic never sees a suffix). Rejected: keeping every pending run in the queue. If a newer push replaces a waiting one, the newer release is built from later main and its generated notes cover the skipped commits; and the suggested `queue:` setting isn't one I could confirm, while an unknown key would invalidate the workflow.
- Follow-up (CodeRabbit on PR #5's last commit): a failed release-list request no longer reads as "no releases" (it was masked by `|| true` and would pick an already-published version); the request is its own assignment under `set -e`, and only the X.Y.Z filter may match nothing.
- PR #4 was merged by the user after CodeRabbit round 1 (CI green, CodeRabbit check passing), so rounds 2-3 didn't happen.

**Next:** check computer audio + microphone recording on Windows; bump `version` in package.json for minor/major releases.

## 2026-11-20 - beautify preview, quick capture menu, recording audio (branch `feat/beautify-preview-audio`)

- **Beautify shows live in the editor.** Before, Beautify only existed in the export, so picking a background changed nothing on screen. The editor now draws the frame around the image with CSS (`#frame` around `#clip`, `paintFrame`): the same gradient, padding, corner radius and shadow as `drawBeautified`, scaled by zoom, so the canvas and its coordinates are untouched. The CSS gradient angle is `atan2(w, -h)`, which makes the gradient line run corner to corner like the canvas one (`beautifyBackgroundCss`, unit-tested). Slider drags preview too (`previewEffects` in the tool store); fit-to-window includes the padding; the frame is hidden while cropping. The overlay (instant preview) still shows Beautify only in the result: its selection sits on the frozen screen, and its hint says so. e2e: picking a background shows the gradient at the frame's corners on screen, and the copy has the same corner colours and the 396 × 296 size.

- **Quick capture left the tray menu.** With instant preview off (the default), Capture area already captures at once, so the item was a duplicate. Its shortcut (unbound by default) and `--quick-capture` still work, so a bound key keeps doing what it did. Unit test: the tray template has no Quick capture.

- **Audio toggles on the record bar.** Before, only the microphone could be recorded, and only via Settings; computer audio wasn't recorded at all (`getDisplayMedia` asked for `audio: false`). The record bar (video only; GIFs and scroll capture have no audio) now has two icon toggles under Start: computer audio (speaker) and microphone (mic), with slashed icons when off, `aria-pressed`, and A / M as keys. A toggle also saves itself as the default (`recording.systemAudio`, `recording.microphone`), and the chosen values travel with the record request (`recordingAudio` validates them and falls back to the saved defaults). Computer audio comes from the display stream, which main answers with Windows loopback; Linux has no loopback, so there the toggle is disabled and its tooltip says so. With both on, the recorder mixes them into one track with Web Audio (a file takes one audio track). Settings ▸ Recording gained the computer audio toggle too.
- GIF conversion read the intermediate video with `UrlSource`, which reads ahead; disposing it aborted those requests, which the e2e harness reports as failed requests (it showed up as a flaky GIF test here). It now reads the local file in one request into a `BufferSource`.
- Tests: unit `recordingAudio` (choice, defaults, malformed input, GIF, unavailable platform); e2e: toggles by click and key, persisted, computer audio disabled on Linux, no toggles for GIFs; a recording with the microphone toggle on has an audio track (Chromium's fake capture device). Screenshot `record-audio.png`. Not verified: computer audio on real Windows.

- CodeRabbit round 1 on PR #4 (4 findings, all fixed): an effects preview is dropped when its popover closes before the slider is released (Esc, another tool); the Beautify frame clips the shadow at its edge like the export; record-bar toggles reached with Tab keep Enter/Space (clicks don't move focus, so Enter still starts); the recording e2e times clips from the recorder's own start (`recordingStarted`).

**Next:** CodeRabbit rounds 2-3, merge; then check computer audio + microphone on Windows.

## 2026-11-20 - capture flow, scroll capture, logo (branch `feat/capture-flow-icons`)

Feedback from testing on Windows.

- **Capture at once, instant preview opt-in.** New `capture.instantPreview` (default off). Off: choosing an area (drag, click, F, R), full-screen capture and "capture last area" run the quick action at once and show the floating thumbnail; its new **Edit** button (with Copy and Save) opens the editor. On: the old flow, with the edit tools on the selection. Full-screen capture without preview takes only the display under the pointer. `quick` mode and OCR are unchanged. The overlay's full-screen size now comes from the display bounds, not `innerWidth` (a capture at load ran before the window had its final size: 1279 instead of 1280). e2e harness: specs start with `instantPreview: true` (they drive the edit tools); `capture-flow.spec.ts` covers the default flow.

- **New logo.** The user's purple logo replaces the generated teal one: `resources/icon.png` (1024 px, installers; electron-builder makes the Windows .ico from it) and `icon-256.png` (their 256 px file). Tray icons (16/32 px, and the recording variant with a red dot) are derived from it by `scripts/make-icons.mjs`, now run with Electron for its image scaler (`bun run icons`). Windows and Linux windows get the icon for the taskbar and Alt+Tab; Settings ▸ About and the README show it. Screenshots: `settings-about.png`, `settings-instant-preview.png`, `floating-thumbnail.png`. Not changed: the default accent stays teal (`#14b8a6`); a purple accent would match the logo but changes every user's UI, so that's the user's call.

- **Scroll capture stopped after the first frame.** Root cause: screen captures draw the mouse pointer into every frame (Chromium reports `cursor: "always"` and ignores `cursor: 'never'`; checked on the box), and while scrolling the pointer sits over the page at a fixed screen spot. Rows under it never matched the previous frame, so `findShift` found no overlap and the HUD failed with "Frames stopped overlapping" (reproduced under Xvfb by moving the real pointer into the region with xdotool). The old e2e never had the pointer inside the region. Fix: the HUD asks main for the pointer each sample (`scroll:pointer`), and the stitcher ignores a box around its last two positions when matching (`pointerArea`, masks per bucket and row). Rows stitched with the pointer in them are repainted row by row from later frames that show them away from the pointer, so the result has no pointer. Lost overlap is now recoverable: the HUD says "Lost track · scroll back up a little", keeps the stitch, and Done delivers it. Tests: unit (pointer in every frame: fails without the mask, rebuilds the page exactly with it; recovery after lost overlap; `pointerArea`), e2e with the pointer inside the region (fails without the fix). CI installs xdotool. Limitation: rows that were both newly revealed under the pointer and never seen again (a very fast scroll at the end) keep it.

- Verified from a fresh clone of `3ca52fe`: install, format, lint, typecheck, 106 unit tests, build, and e2e twice (57 passed, 5 skipped = screenshot generator).

- **CI was flaky** (Actions is enabled again): three intermittent failures. (1) The Settings secret field was controlled with `value=""`, so a re-render between typing and leaving the field (another setting saved) wiped the key and it was never stored: a real bug, now uncontrolled and cleared after sending. (2) Clicking a control that closes its own window (thumbnail Close/Edit) could throw "page closed": `clickClosing` tolerates only that error. (3) `capture-flow` read `history/index.json` before the first delivery wrote it. 4 × repeats of the three specs: 52/52.
- **Releases.** `.github/workflows/release.yml`: a `vX.Y.Z` tag (must match package.json) builds on GitHub's free runners and publishes a release with the Windows x64 and ARM64 NSIS installers (one Windows runner: `bun install --cpu="*"` installs both prebuilt screenshot modules; a check fails the build if an installer lacks its own), the `.deb` and the AppImage (x64), plus GitHub's automatic source code zip. Notes = `.github/release-notes.md` (download table, unsigned-installer note) + GitHub's generated notes. A manual run makes a draft instead; a later tag push refreshes and publishes that draft. "ARM64" was read as Windows on ARM. Not signed: SmartScreen warns.

- CodeRabbit on PR #3 (2 findings, both fixed): `make-icons` now exits 1 when generation fails (Electron otherwise keeps running); the stitcher keeps matching and repairing pointer rows after the height limit without adding rows (offset now advances by the scroll shift, which stays right when appends stop). Release dry run from a temporary branch produced draft `v0.1.0` with all four installers.

**Next:** merge PR #3, push tag `v0.1.0` to publish the draft release; check on Windows: scroll capture in a browser and in another app, at 100 % and 150 % scaling.

## 2026-11-19 - PR #2 CodeRabbit fixes

- `snap45` rounds near-zero axis components to 0, so a Shift-drag along an edge no longer collapses to zero length (`9b45e4a`).
- Moving a selection with measurements limits the shared delta so the measurements stay inside the image (`clampMoveDelta`); other kinds move freely (`eb1fbd2`).
- Editors track the entry they hold; deliveries report the resulting entry before releasing their own hold, and `holdEntry` retains the new entry before releasing the old one (Save as copy, first save) (`7125ee0`).
- `replaceImage` snapshots the image, thumbnail and project, and restores them (or removes new ones) if any write or the index write fails, then rethrows (`57cf593`).
- `checkEditable` validates `edit`/`edit.source` structurally (PNG, non-empty ArrayBuffer, positive integer size); malformed payloads are stored as plain images (`d03339b`).
- History preview: header and grid are `inert` while it's open, and Tab/Shift+Tab cycle inside the dialog (`4c5573b`).
- Pins: zoom-out stops where one row of controls still fits (measured, never above 100 %); the row wraps for smaller pins; Close is first (`ffb3c17`).

- Second CodeRabbit pass (on `e1a228b`): arrow-key nudges of a selection with measurements go through `clampMoveDelta` too (e2e: 10 × Shift+→ stops at the edge, keeps the length); added a rollback test for an overwritten image, thumbnail and project when the index write fails.
- Fresh-clone e2e on `519eb02` failed once in `history-preview.spec.ts`: Space pressed right after closing the preview reached a stale key listener (re-subscribed in a deferred `useEffect`, so it still saw `previewing = true`). The listener now updates in a `useLayoutEffect`. `--repeat-each=10` of the spec: 20/20.
- Third CodeRabbit pass (on `519eb02`): a move drag re-clamps its delta on release against the current endpoints, since an arrow-key nudge during the drag moves them (e2e fails without it: end at 340). The history preview's initial focus and Tab trap moved to layout effects too.
- Fourth CodeRabbit pass (on `e2a723f`): replacing a capture keeps its id, so the History window kept showing the old pixels (preview and, pre-existing, grid thumbnails: same URL, cached image). Entries now get `updatedAt` on replace and the window's media URLs carry `?v=<updatedAt ?? createdAt>` (the protocol route ignores the query). e2e fails without it.
- Fifth CodeRabbit pass (on `8f8b160`): the history selection was an index, so a capture arriving while the preview was open shifted it and actions hit another capture. The selection now re-anchors to its capture's id when the list reloads; if the previewed capture is removed elsewhere (e.g. pruned) the preview closes, while Delete from the preview still moves on to the next one. The replace e2e now also compares a pixel of the edit, not just the width.
- Sixth CodeRabbit pass (on `af4149b`): the id re-anchor and a separate index-bounds effect both corrected the selection in one render, and the deferred bounds update won (e.g. Clear keeping two held captures moved the selection from the kept capture to the other one). One layout effect now does both: keep the capture by id, and clamp only when it is gone. e2e fails without it.
- GitHub Actions is disabled for this repository (`actions/permissions` → `enabled: false`), so no CI has run since the v1 pushes at 20:40; a manual dispatch stays queued. Checks were run on the box instead.

**Next:** PR #2 merged; re-enable Actions (repo Settings ▸ Actions) for Linux + Windows CI and verify on Windows (see the user-feedback entry).

## 2026-11-19 - user feedback (branch `feat/user-feedback`)

Items in order 2, 6, 3, 4, 1, 7, 5.

- **Fix (review):** a fresh-clone e2e run failed once in `save-mode.spec.ts`: Esc right after opening the save menu was lost because focus moved into the menu in a deferred `useEffect` and only the items handled keys. Menu keys are now handled on the split button root (so they work while focus is still on the chevron) and the initial focus uses `useLayoutEffect`. `--repeat-each=8` of the spec: 32/32.

- **2 Measure clamps to the image.** `measureEnd`/`clampPoint`/`clampAlong` (pure, unit-tested). The view has an "image area": the overlay sets it to the selection (in image px), the editor uses the crop or the whole image. Start, end and handle drags of measurements are clamped; with Shift the 45° direction is kept by shortening along the ray instead of clamping per axis. Editor pointer input moved from `#stage` to `#viewport` so a measurement can start in the grey margin; other tools still need to start on the image (text boxes or shapes starting off-image would be surprising). e2e: `measure.spec.ts` (overlay and editor, checked through the saved project document).

- **6 Press-and-hold zoom.** `src/windows/common/repeat.ts`: `createRepeater` (pure timers, unit-tested with fake timers: one step on press, repeat every 70 ms after 350 ms) and `usePressRepeat` (stops on pointerup/leave/cancel, window blur and unmount). Pointer presses step on pointerdown; the click that follows is ignored unless `detail === 0` (keyboard Enter/Space), so a click is exactly one step. Steps read the current zoom (`ui.get()` / a ref) rather than the render's value. Editor −/+ use `RepeatButton`; pins had only wheel zoom and a reset label, so they gained −/+ buttons too. Pin controls moved to the top-left corner: the window resizes from its top-left origin, so a held button stays under the pointer (top-right would slide away and end the hold). The overlay has no zoom buttons. e2e: `zoom.spec.ts`.

- **3 Theme control.** Root cause: `settings.css` hard-coded `#0f0f11` backgrounds for selects, inputs, the shortcut keys and `code` (and the warning colour), the OCR textarea did the same inline, the editor's tool row and checkerboard were fixed dark, and the history/settings bodies painted a translucent token over a dark inline `html` background. `color-scheme` was already switched by `:root.light`, so native popups, checkboxes and scrollbars were fine; the hard-coded colours were not. Fix: themed tokens in `ui.css` (`--window-bg`, `--surface`, `--well-bg`, `--field-bg`, `--field-border`, `--checker-*`, `--warn-*`) and an opt-in `html.app-window` class for opaque windows (the transparent floating preview and pins must not get a background). Image-overlay chips (floating card, pin controls, history card badges) stay dark on purpose: they sit on screenshots, not on the window. Other windows applied the theme once at load; `followTheme()` now re-applies on `settings:changed`, and "System" follows OS changes live via `matchMedia`. The dropdown became a System / Dark / Light segmented control (new `monitor`/`moon`/`sun` icons). Decision: native radio inputs inside labels (visually hidden, still focusable) in a `role="radiogroup"`, instead of buttons with `role="radio"`; the browser provides arrow-key selection, roving focus and checked state, and Biome's a11y rule prefers it. The row is labelled "Appearance" (it themes windows too, not only toolbars); the setting key stays `toolbarTheme`. e2e: `settings.spec.ts` (click, keyboard, computed backgrounds of select/number/text inputs, open History window follows live).

- **4 Tools ▸ Reset to defaults.** The page shows only toolbar visibility, so the reset patch is `toolsPageDefaults()` in `src/shared/settings.ts` (a copy of the default `enabledTools`; other tool choices such as colour and stroke stay). Confirmation is inline: the button turns into "Show every tool again? [Reset] [Cancel]", focus lands on Cancel and Esc backs out; no modal. Settings checkboxes now use the accent colour. Unit: `settings.test.ts`; e2e: `settings.spec.ts` (Esc cancels, confirm restores and persists).

- **1 Edits stay editable from history.** Root cause: deliveries carried only the flattened PNG and the editor opened history entries with `doc: null`. Now an annotated delivery also sends `edit: { doc, source }` (original pixels as PNG + the document in its own coordinates, crop included) and history stores it as `<id>.anyshot` next to `<id>.png`/thumbnail. Decision: reuse the existing `.anyshot` format (one file, one atomic write, so pixels and document can't drift apart) instead of a separate `.src.png` + `.doc.json`; no index change, so old entries simply have no project file and open as images. The PNG stays the rendered result used for thumbnails, copy, drag, pin, OCR, upload and export. Main validates incoming and stored documents structurally (`isProjectDoc`: version, annotation list, unit, crop inside the image) and falls back to the plain image when a project is missing, unreadable or malformed; the editor still validates every annotation. Blank documents (no annotations, crop or effects) send nothing and a re-save without edits deletes the project. Cost: annotated captures encode one more PNG (the original region) in the export worker, in parallel; the editor encodes its source once per window and reuses it for project saves. Delete, prune and clear remove the project file. A delivery that wrote the edits to history now marks the editor clean (nothing is lost on close), and the close prompt says so. Unit: `history.test.ts`, `project.test.ts`; e2e: `history-edit.spec.ts` (annotate in editor → save → close → reopen from History → move/delete/undo the rectangle over the original pixels; damaged project → plain image).

- **7 Replace original / Save as copy.** Editors opened on a history entry (History, floating preview, pin, open-after-quick) show Save as a split button: the main part runs the remembered choice (default Replace, label "Replace" / "Save copy", tooltip with the full name and Ctrl+S), the chevron opens a small menu ("Replace original", "Save as copy", each with a check for the current default and its shortcut). Editors without an original (fresh from the overlay, files, clipboard) keep the plain icon Save. Shortcuts: Ctrl+S = remembered choice, Ctrl+Alt+S = the other (Ctrl+Shift+S and Ctrl+Alt+Shift+S stay Save project / Save project as; Ctrl+Alt+S was unused). Using either option from the menu or a shortcut becomes the new default, stored in settings as `editor.saveMode` (settings store rather than localStorage: one source of truth, validated, survives profile resets the same way as every other choice). Replace sends the entry id (image, document and thumbnail are replaced); copy omits it, so main adds a new entry (with its document, so it stays editable) and the editor then points at the copy; the original's files are untouched. Menu: `role="menu"` with `menuitemradio`s, focus moves into it on open, ↑/↓/Home/End, Enter picks, Esc closes and refocuses the chevron, Tab/outside click/window blur close; menu keys don't reach the editor's shortcuts (arrow nudging, Esc deselect). Tradeoffs: a split button costs one extra 24 px control instead of a modal asking every time; the remembered default means Ctrl+S's meaning can change, which the label and menu always show. Copy, Pin and Done still update the editor's current entry as before (Done is "finish editing this entry"). Unit: `save-mode.test.ts`; e2e: `save-mode.spec.ts` (replace keeps count and updates the entry; copy adds one and leaves the original's project byte-identical; remembered; keyboard; Esc/outside click; plain Save without an original).

- **5 History preview.** Clicking a card selects it and opens a quick look inside the History window (`role="dialog"`, focus moves in): the full image, size, date/time, "n / total", ←/→ (and the side arrows) to move, and Copy / Edit / Pin / Save as… / Delete. Esc, Space, the ✕ or a click on the backdrop close it and focus returns to the card. Only the previewed entry's full image is fetched (`/@history/<id>/image`, one `<img>` at a time); the grid stays thumbnails with `content-visibility`. Mapping change: double-click now opens the editor (was copy). Enter (and now Ctrl+C) still copies, Delete deletes, Ctrl+E edits, Space toggles the preview. A double-click's first click opens the preview, so the backdrop ignores clicks with `detail ≥ 2` and the preview handles `dblclick` (not on its buttons) as Edit; that keeps double-click deterministic without delaying single clicks. Deleting from the preview stays open on the next entry. e2e: `history-preview.spec.ts` (thumbnails only in the grid, one full image on preview, arrows, copy result size, delete, Esc, Space, outside click, double-click → editor).
- **Screenshots** (`ANYSHOT_SCREENSHOTS=1 xvfb-run -a bun run test:e2e tests/e2e/screenshots.spec.ts`): added `settings-theme-light.png`, `settings-theme-dark.png`, `settings-tools-reset.png`, `history-preview.png`, `editor-save-menu.png`, `measure-clamped.png`; `overlay.png`/`editor.png` regenerated.

- **Final verification** on `b7a53ab` under Xvfb: `bun run format:check`, `lint`, `typecheck`, `test` (18 files, 93 unit tests), `build` all pass; `xvfb-run -a bun run test:e2e` twice → 45 passed, 4 skipped (the opt-in screenshot generator) both times; the generator itself passes (4/4). The following commit only refreshes two screenshots (timestamps) and this logbook.
- Not verifiable here: Windows (Ctrl+Alt+S is AltGr+S on some keyboard layouts, which may type a character instead; native radio/checkbox rendering), real system theme switching (Xvfb reports dark/no preference), touch input for press-and-hold.

**Next:** see the PR #2 CodeRabbit fixes entry above.

## 2026-11-19 - PR #1 review fixes

- Fixed all 65 CodeRabbit findings. Censors cover every intersecting pixel, including when filtered pixels are transparent. Magnifiers read the censored image. The editor rejects invalid project crops before displaying the source.
- History retains images for active consumers and preserves indexes it cannot read. Project and settings saves report failures, and automatic saves and recordings reserve distinct filenames.
- Scroll capture stops with a visible error if frames lose overlap and asks for a smaller selection when the controls cannot fit. Remote uploads require HTTPS, with HTTP allowed only on literal loopback addresses. Uploads do not follow redirects, and Linux users can turn weak credential storage back off.
- Linux installer metadata uses the GitHub noreply address. The triage ledger and command results are in `/home/boxes/cr/`.

**Next:** Verify mixed-DPI capture, recording, and installers on Windows, and run capture on GNOME and KDE Wayland.

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
