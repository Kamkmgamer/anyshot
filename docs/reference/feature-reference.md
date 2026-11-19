Contents

1. [Overview & method](#overview)
2. [Where everything lives](#map)
3. [Menu bar menu](#menubar)
4. [Capture flow, step by step](#capture-flow)
   1. [Before selecting](#idle)
   2. [Adjusting the selection](#selection)
   3. [Finishing a capture](#output)
5. [Overlay toolbars](#toolbars)
6. [Annotation tools](#tools)
7. [Editing annotations](#annotating)
8. [Image actions](#actions)
9. [Screen recording](#recording)
10. [Scroll capture](#scroll)
11. [Editor window](#editor)
12. [Studio video editor](#studio)
13. [After-capture windows](#after)
14. [Settings](#settings)
    1. [General](#s-general)
    2. [Capture](#s-capture)
    3. [Shortcuts](#s-shortcuts)
    4. [Tools](#s-tools)
    5. [Recording](#s-recording)
    6. [Uploads](#s-uploads)
    7. [About](#s-about)
15. [App menus (File / Edit)](#appmenu)
16. [Keyboard reference](#keys)
17. [URL scheme](#url)
18. [Permissions](#perms)
19. [Preferences set outside Settings](#hidden)
20. [Notes & discrepancies](#findings)

sw33tLie/macshot · source audit

# macshot Feature Reference

Every setting, sub-setting and feature in the macshot screenshot and recording app, with where to find it and what it does. Built from the app's source code.

Commit **b7655ba** (14 Nov 2026) Latest tag in appcast **v4.5.0-beta.2** Platform **macOS 12.3+**, Swift / AppKit 40 UI languages

Filter the tables

## Overview & method

macshot is a menu-bar app (no Dock icon until an editor window opens). A global hotkey or a menu item freezes every display, shows a full-screen overlay, lets you select an area, annotate it with a floating toolbar, and then copy, save, pin, upload or record it.

**How this report was made.** A fresh boxes.dev session box (`default-box-fork-11cf35f9469d`) cloned `github.com/sw33tLie/macshot` and every user-facing surface was traced in the Swift source: `SettingsWindowController`, `AppDelegate` menus, `OverlayView` input handling, toolbar definitions, tool options, popovers, the image editor, the Studio video editor and each floating window. macshot is a macOS AppKit app and the box runs Linux, so the app was *not launched*. Labels, options and defaults below are read from code, not observed on screen.

**Two builds.** The normal build and an *Offline* build (`macshot Offline`) ship from the same tag. The Offline build removes all upload and cloud features: the Uploads tab, the Upload toolbar button and shortcut, upload menu items and the uploaders themselves. Features marked “not in Offline” below are absent there.

**Stored as.** Most tables list the `UserDefaults` key each control writes. These are handy for `defaults read com.sw33tlie.macshot.macshot` and for comparing exported settings files.

## Where everything lives

##### Menu bar icon

Capture, record, history, open, pin-from-clipboard, Settings, updates, quit. Turns into a stop button while recording.

##### Global hotkeys

13 configurable system-wide shortcuts (6 set by default). Settings ▸ Shortcuts.

##### Capture overlay

Full-screen layer on every display: selection, resolution box, bottom tool strip, right action strip, tool options row.

##### Editor window

Resizable window with all tools plus crop, flip, zoom, add capture and editable `.macshot` projects.

##### Studio video editor

Opens after a recording. Timeline with zooms, cuts, speed, freeze, text, blur, captions, plus a styling inspector.

##### Floating windows

Thumbnail preview, pinned images, history panel, OCR results, upload toast, export progress.

##### Settings window

Seven tabs: General, Capture, Shortcuts, Tools, Recording, Uploads (not in Offline), About.

##### URL scheme

`macshot://` commands for Raycast, Alfred, Shortcuts and scripts.

## Menu bar menu

Click the macshot icon in the macOS menu bar

The first six items follow the order set in Settings ▸ Capture ▸ Menu Bar Order. Each item shows its global hotkey if one is assigned. While the menu is open, ⌘V opens the clipboard image and ⌘O opens a file, unless those items already have their own global shortcut.

| Item | What it does | Default hotkey |
| --- | --- | --- |
| Capture Area | Freezes all screens and opens the selection overlay with the full toolbar. | ⌘⇧X |
| Capture Screen | Captures a whole display without dragging a selection, then shows the toolbars. | ⌘⇧F |
| Capture OCR & QR | Select an area; text and QR codes in it are recognised at once. What happens next follows Settings ▸ Capture ▸ OCR & QR Capture. | ⌘⇧T |
| Quick Capture | Select an area and immediately run the Enter / Quick Capture action (copy, save, both…), with no annotation step. | ⌘⇧S |
| Capture Last Area | Freezes the screen again and opens the overlay with the previous selection rectangle already restored, ready to annotate or finish. | none |
| Scroll Capture | Select an area, then scroll; macshot stitches frames into one tall or wide image. | none |
| Capture Delay ▸ | Submenu: **None**, 3, 5, 10, 30 seconds. Shows a countdown before the screen freezes. Esc cancels the countdown. Stored as `captureDelaySeconds`. | — |
| Record Area | Select an area, then use the recording toolbar to start an MP4 recording. Pressing the hotkey again while recording stops it. | ⌘⇧R |
| Record GIF | Same as Record Area, but the result is a GIF. | none |
| Record Screen | Records a full display. | none |
| Recent Captures ▸ | Submenu of history entries (thumbnail, pixel size, time ago). Clicking one copies it to the clipboard and shows its floating thumbnail. Ends with **Clear History** (asks for confirmation). Shows “No recent captures” when empty. | — |
| Show History Panel | Opens the visual history strip (see [History panel](#after)). | ⌘⇧H |
| Open Image... | Opens an image or a `.macshot` project in the Editor window. | — (⌘O while menu open) |
| Open Video... | Opens any video in the Studio video editor. | — |
| Show Recordings in Finder | Reveals the recordings folder. | — |
| Open from Clipboard | Opens the clipboard image in the Editor window. Alerts if the clipboard has no image. | none (⌘V while menu open) |
| Pin from Clipboard | Pins the clipboard image, or clipboard text rendered as an image, as a floating window. | none |
| Settings... | Opens the Settings window. | ⌘, in menu |
| Check for Updates... | Runs a Sparkle update check now. | — |
| Quit macshot | Quits (waits for pending saves and exports to finish first). | ⌘Q in menu |

While a recording runs, the menu bar icon changes to a stop control: clicking it stops the recording. This works even when “Hide menu bar icon” is on.

## Capture flow, step by step

1. **Trigger.** Hotkey, menu item, or `macshot://capture`. If a capture delay is set, a countdown runs first. The screen under the pointer is captured first, then the other displays; each overlay appears as soon as its display is captured.
2. **Choose a region** on the frozen screen: click a window, drag an area, press F for the full screen, or press R to bring back the last selection.
3. **Adjust** the selection with its 8 handles, the resolution box, aspect/size presets, edge snapping or the Move Selection control.
4. **Annotate** with the bottom tool strip; per-tool options appear in a row next to it.
5. **Finish** with Enter (your Quick Capture action), ⌘C, ⌘S, a double-click, or a right-toolbar action such as Pin, Upload, OCR, Open in Editor or Record. Esc cancels.
6. **Afterwards** a floating thumbnail can appear, the capture enters history, and a capture sound plays (each optional).

### Before selecting

Capture overlay, before any selection exists

A helper pill explains the current mode, for example “Click a window · Drag for custom area · F for full screen” with “Snap mode: WINDOW (Tab to switch)”. Settings ▸ Capture ▸ Hide capture instructions removes it.

| Input | What it does |
| --- | --- |
| Tab snap mode | Cycles **Window** → **Off** → **Element** → Window. Window: hover highlights a window, click captures exactly that window. Element: hover highlights individual UI elements (buttons, panels, web page regions) and needs Accessibility permission. Off: click captures the full screen, drag selects. |
| Click | Window/Element mode: selects the highlighted window or element. Off: selects the full screen. |
| Drag | Draws a rubber-band selection. Dragging across displays produces one stitched image. |
| F | Selects the full screen (while a snap mode is active). |
| R | Restores the last selection rectangle. |
| Right-click | Starts an *anchored selection* without holding the button: move the pointer, then right-click or left-click again to commit; Esc cancels. Useful on trackpads and tablets. |
| Preset button | A pre-selection preset button lets you lock an aspect ratio or exact pixel size before dragging (same list as the resolution presets below). |
| Space while dragging | Moves the selection being drawn instead of resizing it (“Hold Space to move. Release to annotate and edit”). |
| Shift while dragging | Constrains the selection’s proportions. |
| Esc | Cancels the capture. |

### Adjusting the selection

Capture overlay, after selecting: handles, resolution box, right toolbar

| Feature | What it does |
| --- | --- |
| Resize handles | Eight handles on the selection edge. Edges snap to strong colour boundaries in the image (UI lines, window borders); hold ⌥ Option to bypass. Controlled by Settings ▸ Capture ▸ Snap selection edges to image boundaries. |
| Resolution box | Shows width × height near the selection. Width and height are editable fields for an exact size. A **Custom · ratio** button opens the presets popover. |
| Aspect ratio & resolution presets | Popover with two columns. **Aspect ratio:** Freeform, 1:1, 4:3, 3:2, 16:10, 16:9, 21:9, 5:1, 3:4, 9:16 (locks proportions while resizing). **Resolution:** 1920×1080, 1920×384, 1280×720, 1080×1080, 1080×1920, 800×600, 640×480 (sets an exact size). Footer: **Keep ratio for next captures** switch, **Units** px / pt, and an **Auto-adjust selection** button. |
| Auto-Adjust Selection | Shortcut S. Detects nearby edges and snaps the selection to them (“Selection adjusted”, “Selection is already aligned” or “No nearby edges found”). |
| Move Selection | Right-toolbar button (press and drag) or hold Space. Moves the whole selection without resizing; edges still snap (Option bypasses). Moving a window-snapped selection turns it into a normal area. |
| Start captures in move mode | Optional (Settings ▸ Capture). Dragging inside a new selection moves it until you pick a tool. |
| Zoom | Scroll or pinch to zoom the overlay (1×–8×); ⌘0 resets. |
| Live recognition indicator | QR codes and barcodes inside the selection are detected live and offered with Open / Copy actions. |

### Finishing a capture

| Action | What it does |
| --- | --- |
| Enter / numpad Enter | Runs the Enter / Quick Capture action from Settings ▸ Capture (default: copy to clipboard). Optional: also open in Editor. |
| ⌘C or Copy button | Copies the annotated image (PNG + TIFF, plus your image format if enabled). With annotations selected, ⌘C copies those annotations instead. |
| ⌘S or Save button | Saves to the default folder, or asks where (Settings ▸ Capture ▸ Save action). Right-click the button for the other option: “Save As...” or “Save to \<folder>”. |
| Double-click selection | Copies and closes (Settings ▸ Capture ▸ Double-click selection to copy, on by default). |
| Esc | Closes a popover, cancels text editing, clears an annotation selection, or cancels the capture, in that order. |

## Overlay toolbars

Two strips attach to the selection. Their colours follow Settings ▸ General ▸ Appearance. Buttons with a small corner triangle have a right-click menu. Hover shows a tooltip (optionally with the shortcut key).

### Bottom toolbar

Below the selection (hidden entirely with Settings ▸ Tools ▸ Hide the bottom toolbar)

| Button | What it does | Can hide in |
| --- | --- | --- |
| 15 tool buttons | Select & Move, Pencil, Line, Arrow, Rectangle, Ellipse, Marker, Text, Number, Censor, Highlight, Magnify (Loupe), Stamp / Emoji, Color Picker, Measure. See [Annotation tools](#tools). | Tools ▸ Annotation Tools |
| Color swatch | Opens the colour picker popover for the drawing colour. | — |
| Undo / Redo | Steps through annotation history. | — |
| Invert Colors | Inverts the image; apply again to revert. | Tools ▸ Bottom Toolbar Actions |
| Adjust | Image effects popover (presets + sliders). Icon turns yellow while effects are active. | Tools ▸ Bottom Toolbar Actions |
| Beautify | Shows the Beautify options in the options row. Icon turns yellow when Beautify is on. | Tools ▸ Bottom Toolbar Actions |
| Remove Background | Cuts out the foreground subject (macOS 14+). | Tools ▸ Bottom Toolbar Actions |

### Right toolbar

Right of the selection (vertical strip)

| Button | What it does | Right-click |
| --- | --- | --- |
| Cancel (✕) | Closes the overlay. Not shown in the Editor window. | — |
| Move Selection | Press and drag to move the selection. | — |
| Open in Editor Window | Moves the capture and its annotations into the Editor window. Shortcut E. | — |
| Copy | Copies the result. | — |
| Save | Tooltip names the target folder or “Ask where to save”. | Save As... / Save to \<folder> |
| Share | macOS share picker. | — |
| Upload not in Offline | Uploads to the provider chosen in Settings ▸ Uploads; the link is copied. Shortcut U. | Popover with **Confirm before upload** checkbox |
| Pin | Turns the capture into an always-on-top floating window. Shortcut F after selecting. | — |
| OCR & QR | Recognises text and QR codes in the selection and opens the OCR window. | — |
| Translate | Toggle. Recognises text, translates it, and paints the translation over the original. Click again to remove. | Target language list (30 languages) |
| Scroll Capture | Starts scroll capture on this selection. Not in the Editor or during recording. | — |
| Record | Switches the right toolbar into recording setup mode. Not in the Editor. | — |

Share, Upload, Pin, OCR & QR, Translate, Scroll Capture and Record can each be hidden in Settings ▸ Tools ▸ Right Toolbar Actions. Cancel, Move, Open in Editor, Copy and Save are always present.

### Tool options row

A third strip with real sliders and segmented controls for the current tool. When an existing annotation is selected, it edits that annotation. When Beautify is open, it shows Beautify controls instead. Details per tool follow.

## Annotation tools

Overlay or Editor ▸ bottom toolbar ▸ tool button (or its single-key shortcut)

Single-key shortcuts work after a selection exists and can be changed in Settings ▸ Shortcuts. Stroke sliders run 1–30.

| Tool · key | What it does | Options row |
| --- | --- | --- |
| Select & Move V | Never draws. Click an annotation to select it, drag empty space for a marquee multi-select, then move, resize, rotate or delete. | Shows the selected annotation’s own options. |
| Pencil P | Freehand drawing. | Stroke · Line style (solid / dashed / dotted) · Smoothing **None / Smooth / Refined** · **Pressure** toggle (pen/tablet pressure varies width). |
| Line L | Straight line. Shift snaps to 45°. Right-click on a line adds an anchor point for multi-segment paths; a bend handle curves it. | Stroke · Line style · **Outline** toggle + outline colour. |
| Arrow A | Arrow with bend handle and right-click anchor points. | Stroke · Line style · Arrow style **Single, Thick (banner), Double, Open, Tail, Sketchy** · Outline + colour · **Flip** (reverse direction). |
| Rectangle R | Rectangle; Shift for a square. | Stroke · Line style · Fill **Stroke / Stroke + Fill / Fill** · **Radius** (corner) · Outline + colour (outline disables dashed/dotted). |
| Ellipse O | Ellipse; Shift for a circle. | Stroke · Line style · Fill style · Outline + colour. |
| Marker M | Semi-transparent highlighter. | Stroke · **Smart** toggle: snaps the highlight to lines of text found by OCR and sizes it automatically (stroke slider disabled). Shift draws a straight line. |
| Text T | Resizable rich-text box. Click existing text to edit it again. | Font family picker · **B** / *I* / U / S · Align left / centre / right · font size − / + · **Fill** (background) + colour · **Outline** (box outline) + colour · **Stroke** (letter outline) + colour · Cancel / Confirm. |
| Number N | Auto-incrementing numbered badge with a draggable pointer tip. | Size · Format **1 / I / A / a** · **Start:** stepper (1–999) · Outline + colour. |
| Censor B | Redaction region. | Mode **Pixelate / Blur / Solid / Erase** (Erase fills from surrounding colours) · **Draw: All / Text Only** (Text Only censors just the text inside the drawn box) · **Auto:** buttons **All Text**, **PII** (with ▾ type list), **Faces**, **People**. |
| Highlight (Spotlight) H | Keeps the drawn area bright and dims the rest of the image. | **Dim** strength 10–95% · Border solid / dashed. |
| Magnify (Loupe) no key | Click to place a circular magnifier. | **Size** 40–320 · **Zoom** 1.1×–6× · Outline + colour. |
| Stamp / Emoji G | Places an emoji or image. The first quick emoji is pre-selected. | **Size** · 17 quick emojis (👆👇👈👉 ✅❌⚠️❓ 🔥🐛👀💡 🎯⭐❤️👍 👎) · **More Emojis** (categorised picker with search) · **Load Image** (any image file). |
| Color Picker I | Eyedropper with magnified preview. Click: sets the drawing colour (“Set color #hex”). Right-click: copies the hex value (“Copied #hex”). | — |
| Measure no key | Pixel ruler with 45° snap; right-click adds anchor points. | **px / pt** units · **Set Scale...** (real-world units: mm, cm, m, in, ft) · **Limit to selection** · hint: hold 1 for an automatic vertical measurement, 2 for horizontal. |
| Crop Editor only | Crop with a rule-of-thirds grid, from the Editor top bar. | — |

#### Measure ▸ Set Scale popover

Draw or select a measure line along something of known length, enter its real length (“90 mm”, “3.5 in” or “3 1/2 in”), then **Set Scale**. Every measure line is relabelled. With a scale set, the popover shows “Current scale: 1 unit = N px”, a **Show lengths in** unit menu (Millimeters, Centimeters, Meters, Inches, Feet) and **Remove Scale**. **Draw Reference Line** starts drawing a reference. Undo reverts a scale change in one step.

#### Auto-redact PII types

Censor tool ▸ Auto: PII ▾

Each type is a toggle (all on by default): Emails, Phone Numbers, SSN, Credit Cards, CVV Codes, Expiry Dates, IP Addresses, AWS Keys, Secrets/Tokens, Hex Keys, Bearer Tokens. Detection runs OCR and pattern matching, then adds censor boxes that undo together as one step.

## Editing annotations

Overlay or Editor, with any tool

| Interaction | What it does |
| --- | --- |
| Click an annotation | Selects it from any tool (no need to switch to Select). Shows handles, a rotate handle and a delete circle. |
| Drag / handles | Moves or resizes. Rotate with the rotate handle; Shift snaps to 90°. |
| Arrow keys | Nudge selected annotations 1 pt; Shift = 10 pt. One undo step per nudge run. |
| Delete / ⌦ | Deletes the selected annotations. With several selected, a “Delete N” button also appears. |
| ⌘C / ⌘V | Copies and pastes annotations (also between captures). ⌘V with an image on the clipboard drops it in as a movable layer. |
| ⌘D | Duplicates the selected annotations. |
| Shift while drawing | Straight lines, 45° angles, squares and circles. |
| Space while drawing | Repositions the shape being drawn without changing its size. |
| Right-click line / arrow / measure | Adds an anchor point, creating curves with several segments. |
| Right-click inside selection | Radial colour wheel. Drag to a colour and release, or release without dragging to keep the wheel open and click a colour. |
| Snap guides | While moving, annotations snap to edges and midlines of others (Settings ▸ Capture ▸ Show snap alignment guides). |
| ⌘Z / ⌘⇧Z / ⌘Y | Undo / redo (configurable in Settings ▸ Shortcuts). |

#### Colour picker popover

Bottom toolbar ▸ colour swatch, and colour swatches in the options row

Preset swatches (12 by default, editable in Settings ▸ Tools ▸ Default Colors, up to 24), an HSB gradient, a brightness slider, an opacity slider, a hex field and custom colour slots that the Color Picker tool can fill. Opacity applies per annotation.

## Image actions

### Beautify

Bottom toolbar ▸ Beautify (sparkles icon) ▸ options row

| Control | What it does |
| --- | --- |
| Beautify checkbox | Turns the frame on or off for the output. |
| Mode **W** / **R** | W: macOS window frame with traffic lights. R: rounded corners only. |
| Padding | 16–96 pt of background around the image. |
| Radius | 0–30 corner radius. |
| Shadow | 0–100 shadow radius. |
| Background | Toggle for the gradient/image background. |
| Blur | 0–50 blur for a custom background image. |
| Gradient Style swatch | Opens the gradient grid: linear gradients, 18 mesh gradients on macOS 15+, and a custom image background. |

### Adjust (Image Effects)

Bottom toolbar ▸ Adjust (sliders icon) ▸ popover

Non-destructive filters with live preview, usable with or without Beautify. **Presets:** None, Noir, Mono, Sepia, Chrome, Fade, Instant, Vivid. **Adjustments:** Brightness (−0.5 to 0.5), Contrast (0.5–2), Saturation (0–2), Sharpness (0–2). **Reset** clears everything; moving a slider clears the preset.

### Other actions

| Action | Where | What it does |
| --- | --- | --- |
| Invert Colors | Bottom toolbar | Inverts the captured pixels; run again to revert. |
| Remove Background | Bottom toolbar (macOS 14+) | Apple Vision foreground mask; keeps the subject and makes the background transparent. |
| Translate overlay | Right toolbar | OCR → translate → paints translated text over the original. Engine: Apple on-device or Google Translate (Settings ▸ Capture ▸ Translation). 30 target languages. |
| OCR & QR | Right toolbar, hotkey, menu | Text recognition in all languages Apple Vision supports, plus QR codes. Opens the OCR window and/or copies text, per settings. |
| Pin | Right toolbar | Floating always-on-top window, placed at screen centre or the original capture position. |
| Share | Right toolbar | macOS share sheet. |
| Upload | Right toolbar (not in Offline) | imgbb, Google Drive or S3-compatible; progress toast, then the URL is on the clipboard. |
| Open in Editor | Right toolbar, E | Continues editing in a full window. |

## Screen recording

### Recording setup toolbar

Record Area / Record GIF / Record Screen, or overlay ▸ right toolbar ▸ Record

The bottom toolbar disappears and the right toolbar becomes:

| Button | What it does | Right-click |
| --- | --- | --- |
| Start Recording | Red record button. Starts recording the selection. | — |
| Cancel Recording | Leaves recording mode without recording. Esc does the same. | — |
| Highlight Mouse Clicks | Ripple on each click. Needs Input Monitoring. | — |
| Show Keystrokes | On-screen keystroke labels. Needs Input Monitoring. | **Shortcuts Only** / **All Keystrokes** |
| Record System Audio | Captures system audio (excluding macshot’s own sounds). | — |
| Record Microphone | Records a mic track; the button shows the input level. Asks for microphone permission. | **None** + list of input devices |
| Webcam Overlay | Shows a camera bubble you can drag and resize before and during recording. Asks for camera permission. | **None** + list of cameras |
| Recording Settings (gear) | Popover for this recording only: **FPS** 15/30/60/120 · **When done** · **Delay** None/3/5/10/30 s · **Hide controls**. With the webcam on: **Cam pos** ↙↘↖↗ · **Cam size** · **Cam shape** ● / ▢. | — |
| Move Selection | Moves the recording area before starting. | — |

### While recording

- **Recording HUD**: floating control with **Pause / Resume** and **Stop Recording**. Hidden when “Hide recording controls” is on.
- **Menu bar icon** becomes a stop button.
- The record hotkey pressed again stops the recording; `macshot://stop-recording` also works.
- A visible selection border, click highlights, keystrokes and the webcam bubble are drawn as configured. With “Editable pointer” on, pointer, clicks, keystrokes and camera are recorded separately so the Studio editor can restyle them.

### When it ends

The **When done** choice runs: **Open editor** (default, opens Studio), **Show in Finder**, **Copy to clipboard**, or **Save + copy to clipboard**. Each take is kept in its own folder until you delete it. When a recording has both microphone and system audio, an **Audio Tracks** dialog lets you set Microphone and System audio volume, then **Merge Audio** or **Keep Separate**.

## Scroll capture

Menu ▸ Scroll Capture, or overlay ▸ right toolbar ▸ Scroll Capture

Select the scrolling area, then scroll it normally. macshot grabs frames as content moves, works out the exact shift, and stitches only the moving columns. Fixed headers, sidebars, bottom banners and pinned boxes appear once. Vertical and horizontal scrolling are detected automatically.

| Control | What it does |
| --- | --- |
| HUD info | “Scroll Capture · W×H” showing the stitched size so far. |
| Auto Scroll button | Scrolls the page for you with synthetic scroll events (“Scrolling...” while active). Needs Accessibility permission. Speed set in Settings ▸ Recording ▸ Scroll Capture. |
| Stop button / Enter | Finishes and delivers the image using your Quick Capture action. |
| ⌘C | Finishes and copies the stitched image (still saves if your Quick Capture action saves). |
| Esc | Cancels. |
| Preview panel | Live preview of the stitched image beside the capture region. |
| Max height | Capture stops at the configured limit (default 30,000 px). |

## Editor window

Overlay ▸ Open in Editor Window (E), thumbnail/pin/history ▸ Edit, Open Image..., Open from Clipboard

A resizable window containing the same bottom toolbar, options row and right toolbar (without Cancel, Move, Record and Scroll Capture), plus a top bar. The canvas zooms from 10% to 800%.

| Top bar item | What it does |
| --- | --- |
| Size label | Pixel dimensions of the image. |
| Crop | Crop mode with a rule-of-thirds grid. Annotations move with the crop and undo with it. |
| Flip Horizontal / Flip Vertical | Mirrors the image and its annotations. |
| Add Capture | Captures another screen region and adds it to the canvas as a movable layer, for composing several captures into one image. |
| Save as Editable Project | Writes a `.macshot` file with every annotation still editable (⇧⌘S; Save As ⌥⇧⌘S). Reopening it restores the annotations and edit state. |
| Drag handle | “Click to copy · Drag to app”: click copies the edited image, drag drops it into another app as a file. |
| Zoom menu (“100% ▾”) | Zoom In ⌘+, Zoom Out ⌘−, Fit Canvas ⌘1, 50%, 100% ⌘0, 200%. |
| Done | For captures opened from history: saves the edits back to that history entry. |

- ⌘V pastes a clipboard image as a draggable layer.
- Annotations can extend past the image edge; the canvas grows to fit them.
- Closing with unsaved changes asks: **Save & Close**, **Discard** or **Cancel**. A window linked to a project shows its file name and a dirty dot, and Save & Close writes the project.
- “Close editor after copying” (Settings ▸ Capture) closes the window after ⌘C.
- While any editor is open macshot shows a Dock icon and its menu bar (File, Edit).

## Studio video editor

Opens after a recording (When done = Open editor), or Menu ▸ Open Video...

Edits are saved as a project beside the recording, so reopening a take keeps your work. Every export uses the same renderer as the preview.

### Top bar and stage

| Control | What it does |
| --- | --- |
| Undo / Redo | Project history. |
| Export | Opens the export panel (⌘E). |
| Copy | Copies the edited video to the clipboard (⌘C). |
| Crop / Done, Reset | Crop the recording on the stage; Reset clears the crop. |
| Aspect ratio menu | Output canvas: Auto, 16:9, 9:16, 1:1, 4:3, 3:4, 4:5, 16:10. |

### Transport and timeline

| Control | What it does |
| --- | --- |
| Add ▾ | Menu: **Zoom**, **Auto Zoom** (needs pointer data), **Cut**, **Speed**, **Freeze Frame**, **Text**, **Blur**. Items are inserted at the playhead. |
| Auto Zoom | Adds zooms that follow the pointer wherever you clicked or typed (“Added N zooms”). |
| Play/Pause, Previous edit, Next edit | Playback and jumping between edits. |
| Mute | Mutes preview audio. |
| Timeline zoom −/+, Fit | Horizontal timeline zoom; also pinch or ⌘/⌥+scroll. |
| Lanes | **Clip** (trim), **Zoom** (double-click to add), **Edits** (cuts, speed, freeze frames), **Overlays** (text and blur), **Captions**. Right-click: Add Zoom Here / Add Cut Here / Add Text Here. |
| Segment context menu | Zoom: Follow Pointer / Hold Focus. Blur: switch Blur / Pixelate / Solid. Text: Edit Text. All: Delete. |

### Inspector tabs

| Tab | Controls |
| --- | --- |
| Background | **Frame the recording** (background, padding, rounded corners, shadow) · Background **Gradient / Wallpaper / Color / Image** (Choose Image…, Custom color, system wallpapers) · **Background blur** · Frame: **Padding**, **Corner radius**, **Shadow**, **Edge highlight**. |
| Pointer | **Show pointer** · Style **macOS / Dot / Ring** · Size · Smoothing · Motion blur · Sway · Clicks **None / Ripple / Spotlight / Ring** · Click color · Press animation · Visibility: **Hide when idle**, Idle delay 0.5–10 s, **Hide while typing**, **Return to start at the end** (seamless looping GIFs). Only for takes recorded with “Editable pointer”. |
| Zoom | **Auto Zoom** · **Remove Automatic Zooms** · Motion: Default zoom 1.2×–4×, Transition **Gentle / Smooth / Snappy**, **Connect nearby zooms** (pan instead of zooming out), Motion blur, Follow tightness · **Apply Default Zoom to All**. |
| Keystrokes | **Show keystrokes** · **Shortcuts only** · Size 0.5–2.5 · Light appearance · Position. Needs Show Keystrokes on while recording. |
| Camera | **Show camera** · Shape **Circle / Square / Wide / Tall** · Size · Mirror · **Shrink during zooms** · Shadow · Position (**Original** follows where it was during recording). Needs the webcam on while recording. |
| Captions | **Generate / Regenerate Captions** (on-device speech recognition, nothing uploaded) · Show captions · Size 16–120 · Background · Position · **Export Subtitles (.srt)…** · Remove Captions. |

#### Selected segment inspectors

- **Zoom**: Zoom level, Focus **Fixed point / Follow pointer**, Zoom in and Zoom out durations (0.1–2.5 s); drag the frame on the preview to aim it.
- **Blur**: Style Blur / Pixelate / Solid, with a note that Solid is the safe choice for sensitive data.
- **Text**: Font, Size 12–200, Regular / Bold / Italic / Bold Italic, Left / Center / Right, Text colour, Background **None / Box / Pill** + colour, Outline + colour + width, Fade in / Fade out (0–2 s). Double-click the text on the preview to edit.
- **Cut**: shows how many seconds are removed; drag its edges to adjust.
- **Speed**: speed factor slider.
- **Freeze Frame**: Duration (up to 10 s).
- **Caption**: edit the caption text. Every segment has a **Delete** button.

#### Export panel

**Format** MP4 / GIF · **Resolution** (original or scaled) · **Quality** High / Medium / Low (with size estimate where reliable) · **Frame rate** · buttons **Save**, **Save As…**, **Copy**, **Upload** (Google Drive or S3 only; imgbb takes images only; not in Offline), **Show in Finder**. Esc cancels a running export.

## After-capture windows

### Floating thumbnail

Screen corner after a capture (Settings ▸ Capture ▸ Show floating thumbnail after capture)

| Element | What it does |
| --- | --- |
| Corner buttons (on hover) | Top-left ✕ close · top-right pin · bottom-left pencil (open in Editor) · bottom-right upload (not in Offline). |
| Centre buttons | **Copy** and **Save**. |
| Click elsewhere on it | Runs the “Click on preview” setting (Dismiss, Open in Editor, Copy & dismiss, Do nothing). |
| Drag it out | Drops the image into another app as a file. |
| Drag or swipe toward the screen edge | Dismisses it (two-finger swipe works too). |
| Right-click menu | Copy ⌘C · Save · Save As... · Open in Editor · Pin to Screen · Upload · Quick Look · Run OCR & QR · Rotate Left / Rotate Right / Flip Horizontal / Flip Vertical · Open With ▸ · Share ▸ · Delete · Close All · Save All to Folder… |
| Auto-dismiss | After the configured seconds (default 5; 0 never). It stays while an editor opened from it is open. |

### Pinned image

Right toolbar ▸ Pin, thumbnail ▸ pin, history ▸ Pin to Screen, Pin from Clipboard

- Always on top, on every Space, draggable by its body.
- Hover shows a zoom percentage, a pencil (open in Editor) and ✕ (close). Click the percentage to reset zoom.
- Scroll or pinch to zoom from 10% to 500%.
- Right-click: Copy to Clipboard, Save As..., Close. Esc closes.

### History panel

Menu ▸ Show History Panel (⌘⇧H) or `macshot://history`

- Horizontal strip of recent captures with filters **All / Screenshots / GIFs** and a trash button that clears history (with confirmation).
- Click a card to copy it; drag a card into another app.
- Keys: ←/→ select · Return copy · Space Quick Look · Delete delete · ⌘E open in Editor · Esc close.
- Right-click: Copy, Save As..., Open in Editor, Pin to Screen, Upload, Quick Look, Run OCR & QR, Delete. Opening in the Editor keeps annotations editable.

### OCR result window

After Capture OCR & QR or the OCR & QR button

- Title “Text Recognition” or “Text & QR Recognition”. Editable recognised text with a character and word count.
- **Translate to:** language menu and a **Translate** / **Show Original** toggle (undoable).
- **Copy ⌘↩** and **AI Search** (sends the text to a web AI search).
- QR code section: each code with **Copy** and **Open Link**.

### Other windows

| Window | What it does |
| --- | --- |
| Upload toast | “Uploading... N%”, then “URL copied to the clipboard” with an **Open** button, or the failure reason. |
| Export progress | Shows long saves and exports with a **Cancel** button. Exports finish even if their window closes. |
| Failure toast | Appears when a save or recording fails, so a capture is never lost silently. |
| Permission onboarding | First launch: “macshot needs one permission” with **Open Screen Recording Settings** and **Continue**. After updates that reset permission: “Turn Screen Recording back on” with steps, a Terminal reset command (**Copy Command**) and **Restart macshot**. |

## Settings

Menu bar ▸ Settings... · `macshot://settings`

A fixed-size window with a toolbar of seven tabs. The title reads “macshot Settings · \<tab>”. ⌘Q closes Settings instead of quitting. The footer shows “Made by sw33tLie” and a GitHub link. Changes apply immediately unless noted.

### General tab

#### Language

| Setting | Options · default | What it does | Stored as |
| --- | --- | --- | --- |
| Language | **System Default** + 40 languages (Arabic … Traditional Chinese) | UI language. Restart the app to apply it fully. | appLanguage |

#### Application

| Setting | Options · default | What it does | Stored as |
| --- | --- | --- | --- |
| Launch at login | Off | Registers macshot as a login item (macOS 13+). | launchAtLogin |
| Hide menu bar icon | Off | Removes the icon; hotkeys still work. Relaunch macshot to get the icon back. The stop button still appears while recording. | hideMenuBarIcon |
| Menu bar icon | **Default** / Custom symbol | Custom symbol enables a text field for any SF Symbol name and a **Presets** pull-down (camera.viewfinder, camera, camera.fill, camera.aperture, viewfinder, crop, crop.rotate, scissors, rectangle.dashed, square.dashed, photo, record.circle). Invalid names fall back to the default. | statusBarIconMode statusBarIconSymbolName |
| Enable macshot:// URL scheme | On | Lets other apps trigger macshot by URL. The ⓘ icon lists every command (see [URL scheme](#url)). | urlSchemeEnabled |
| Check for updates automatically | On | Sparkle background checks. | SUEnableAutomaticChecks |
| Check for beta updates | Off | Also offers beta releases. | betaUpdatesEnabled |

#### Appearance

| Setting | Options · default | What it does | Stored as |
| --- | --- | --- | --- |
| Toolbar appearance | **Dark** / Light / Follow System | Colour scheme of toolbars, popovers, HUDs and the editor top bar, independent of macOS unless Follow System. | hudAppearance |
| Theme | **Default**, Classic, Ocean, Sunset, Forest, Mono, Custom | Sets the three colours below in one step. Shows Custom when the colours match no preset. | — |
| Accent | Purple | Selection handles, selected buttons and highlights. | toolbarAccentColor |
| Icon | White | Toolbar icon colour. Disabled when Toolbar appearance is Light. | toolbarIconColor |
| Background | Near-black | Toolbar background. Disabled when Light. | toolbarBgColor |

#### Settings Backup

| Control | What it does |
| --- | --- |
| Export Settings… | Saves preferences as JSON. Leaves out upload credentials, the save folder and history. A very large custom Beautify background may be skipped (you are told). |
| Import Settings… | Confirms, then replaces current preferences (save folder, credentials and history are kept). Reports how many settings were applied and offers **Relaunch Now** / Later. |
| Reveal Settings File in Finder | Shows macshot’s preferences plist. |

### Capture tab

#### Capture

| Setting | Options · default | What it does | Stored as |
| --- | --- | --- | --- |
| Enter / Quick Capture | Save to file · **Copy to clipboard** · Save + copy to clipboard · Save + Copy Path · Do nothing | What Enter, Quick Capture and scroll-capture Stop do. | quickCaptureMode |
| └ Also open in Editor | Off | After the Enter/Quick Capture action, also opens the Editor. | quickCaptureOpenEditor |
| └ Close editor after copying | Off | Closes the Editor window after you copy. | closeEditorAfterCopy |
| Pin position | **Center of screen** / Original capture position | Where new pins from the overlay appear. | pinPlacement |
| OCR & QR Capture | **Show window + copy to clipboard** · Show window only · Copy to clipboard only | Result handling for OCR captures. | ocrAction |
| Open in Editor right after selection | Off | Skips the overlay toolbar and opens the Editor as soon as you select. | openEditorAfterSelection |
| Play sound on capture | On | Capture/copy sound. | playCopySound |
| Start captures in move mode | Off | Dragging inside a fresh selection moves it until a tool is picked. | startCapturesInMoveMode |
| Remember last selected tool | On | Next capture starts with the tool you used last. | rememberLastTool |
| Show floating thumbnail after capture | On | Shows the preview window after each capture. | showFloatingThumbnail |
| └ Dismiss after | 0–60 s, **5** (0 = never) | Auto-dismiss delay. | thumbnailAutoDismiss |
| └ Multiple previews | **Stack (keep all)** / Replace (show only latest) | Whether new previews stack. | thumbnailStacking |
| └ Click on preview | **Dismiss** · Open in Editor · Copy & dismiss · Do nothing | Action when you click the preview body. | thumbnailClickAction |
| └ When opened in Editor | **Close preview** · Keep in stack · Return to stack when editor closes | What the preview does while its capture is being edited. | thumbnailEditBehavior |
| └ Position | **Bottom Right** · Bottom Left · Top Right · Top Left | Screen corner. | thumbnailCorner |
| └ Preview size | 50%–200%, **100%** | Thumbnail scale. | thumbnailScale |
| └ Fit image in preview (letterbox) | Off | Shows the whole image instead of filling the tile. | thumbnailLetterbox |
| Show snap alignment guides | On | Guide lines and snapping when moving annotations. | snapGuidesEnabled |
| Snap selection edges to image boundaries | On | Edge snapping for selection resize/move (hold Option to bypass). | boundarySnapEnabled |
| Enhance browser and Electron element snapping | On | In Element snap mode, builds the target app’s accessibility tree so web content can be snapped. Turn off if a browser or Electron app gets slow. | — |
| Capture mouse cursor in screenshot | Off | Includes the pointer in screenshots. | captureCursor |
| Double-click selection to copy | On | Double-click copies and closes. | doubleClickToCopy |
| Hide capture instructions | Off | Hides the helper pills on the overlay. | hideCaptureInstructions |
| Disable shadow outside selection | Off | No dimming outside the selection. | disableSelectionOutsideShadow |

#### Output

| Setting | Options · default | What it does | Stored as |
| --- | --- | --- | --- |
| Save action | **Save to default folder** / Ask where to save | Behaviour of Save / ⌘S. | saveAction |
| Save folder | Browse… | Default folder for screenshots (remembered with sandbox access). | saveDirectory (bookmark) |
| Copy Path | Off | After saving, puts the file path on the clipboard. | copyPathAfterSave |
| Filename | `Screenshot {date} at {time}` | Template with live preview, ⓘ token list and Reset. A `/` creates subfolders inside the save folder. Tokens: `{date}` `{time}` `{timestamp}` `{unix}` `{window}` `{index}` `{random}` `{app}` `{yyyy}` `{MM}` `{dd}` `{HH}` `{mm}` `{ss}` `{ms}`. | filenameTemplate |
| Image format | **PNG** · JPEG · HEIC · WebP · AVIF | File format for saves (AVIF/HEIC only where macOS supports them). | imageFormat |
| └ Also copy to the clipboard in this format | Off (disabled for PNG) | Adds the chosen format to the clipboard ahead of PNG/TIFF. | clipboardIncludesImageFormat |
| Quality | 10–100%, **85%** | Lossy formats only (JPEG, HEIC, WebP, AVIF). | imageQuality |
| Save at standard resolution (1x) | Off | Halves Retina dimensions for \~4× smaller files. | downscaleRetina |
| History size | 0–50, **10** (0 = off) · Unlimited | How many captures history keeps. | historySize historyUnlimited |
| Order history by last edit | Off | Edited captures move to the top. | historyOrderByLastEdit |

#### Translation (shown only where Apple Translation is available, macOS 15+)

| Setting | Options · default | What it does | Stored as |
| --- | --- | --- | --- |
| Engine | Apple (on-device) / Google Translate | Apple is faster and offline; Google covers more languages. A link opens System Settings to download Apple language packs. | — |

#### Menu Bar Order

A list of the six capture items (Capture Area, Capture Screen, Capture OCR & QR, Quick Capture, Capture Last Area, Scroll Capture) with ▲/▼ buttons, plus **Reset to default**. Changes the order at the top of the menu bar menu. Stored as `captureMenuItemOrder`.

### Shortcuts tab

#### Keyboard Shortcuts (global)

Each row: current shortcut, **Set** (then press a combination with ⌘, ⌥, ⌃ or ⇧; function keys may stand alone), ✕ to clear, ↺ to reset. Assigning a shortcut already in use moves it away from the other action. Recording pauses all hotkeys.

| Action | Default |
| --- | --- |
| Capture Area | ⌘⇧X |
| Capture Screen | ⌘⇧F |
| Record Area | ⌘⇧R |
| Record Screen | None |
| History | ⌘⇧H |
| Capture OCR & QR | ⌘⇧T |
| Quick Capture | ⌘⇧S |
| Scroll Capture | None |
| Open from Clipboard | None |
| Capture Last Area | None |
| Pin from Clipboard | None |
| Clear History | None |
| Record GIF | None |

#### Undo / Redo

Undo ⌘Z; Redo ⌘⇧Z and ⌘Y. A new chord must include ⌘. Applies to the overlay, the Editor, the Studio editor and the Edit menu.

#### Overlay / Editor Shortcuts

**Show shortcuts in tooltips** (off) adds the key to toolbar tooltips. Each action takes a single key without ⌘/⌥/⌃ (Esc cancels recording a key). They work once a selection exists, in the overlay and the Editor.

| Action | Default | Action | Default |
| --- | --- | --- | --- |
| Select & Move | V | Move Selection | Space |
| Pencil | P | Auto-Adjust Selection | S |
| Arrow | A | Open in Editor | E |
| Line | L | Pin | F |
| Rectangle | R | Upload (not in Offline) | U |
| Ellipse | O | Copy | None |
| Marker | M | Save | None |
| Text | T | OCR & QR | None |
| Number | N | Scroll Capture | None |
| Censor | B | Beautify | None |
| Highlight | H | Invert Colors | None |
| Color Picker | I | Remove Background | None |
| Stamp | G | Translate | None |
| Measure | None | Loupe | None |

### Tools tab

| Section | Contents · default | What it does | Stored as |
| --- | --- | --- | --- |
| Hide the bottom toolbar | Off | Removes the whole tool strip; pick tools with their keys instead. | hideBottomToolbar |
| Annotation Tools | All on: Select & Move, Pencil, Line, Arrow, Rectangle, Ellipse, Marker, Text, Number / Counter, Censor, Highlight (Spotlight), Magnify (Loupe), Stamp / Emoji, Color Picker, Measure | Unchecked tools disappear from the bottom toolbar. Tools added in future versions start enabled. | enabledTools |
| Bottom Toolbar Actions | All on: Invert Colors, Adjust (Image Effects), Beautify, Remove Background | Show or hide these bottom-strip actions. | enabledActions |
| Right Toolbar Actions | All on: Upload, Pin (floating window), OCR & QR, Auto-Redact sensitive data, Translate, Record screen, Scroll Capture, Share | Show or hide these right-strip actions. | enabledActions |
| Default Colors | 12 swatches · **Add Color** (max 24) · Reset to default | Edits the preset swatches in the colour picker; each swatch can be changed or removed. | presetColors |

### Recording tab

#### Output

| Setting | Options · default | What it does | Stored as |
| --- | --- | --- | --- |
| Frame rate | 15 · 24 · **30** · 60 · 120 fps | Default MP4 frame rate (per-recording override in the gear popover). | recordingFPS |
| Save folder | Browse… / Clear | Where recordings are saved; Clear returns to the default. | (bookmark) |
| Filename | `Recording {date} at {time}` | Template with preview, tokens and Reset (same tokens as screenshots). | recordingFilenameTemplate |

#### Behavior

| Setting | Options · default | What it does | Stored as |
| --- | --- | --- | --- |
| When done | **Open editor** · Show in Finder · Copy to clipboard · Save + copy to clipboard | What happens when a recording stops. | recordingOnStop |
| Editable pointer, clicks and keystrokes | On | For recordings that open in the editor, records the pointer, clicks, keystrokes and camera separately so Studio can smooth, restyle, hide or zoom to them. | recordEditablePointer |
| Hide recording controls | Off | No floating HUD; stop from the menu bar icon. | hideRecordingHUD |

#### Webcam

| Setting | Options · default | What it does | Stored as |
| --- | --- | --- | --- |
| Position | **Bottom Right** · Bottom Left · Top Right · Top Left | Starting corner of the webcam bubble. | webcamPosition |
| Size | 80–480 px, **120** | Bubble size. | — |
| Shape | **Circle** / Rounded Rectangle | Bubble shape. | webcamShape |
| Snap webcam to corners when moved | — | Dragged bubble snaps to the nearest corner. | — |

#### Scroll Capture

| Setting | Options · default | What it does | Stored as |
| --- | --- | --- | --- |
| Auto-scroll (sends synthetic scroll events) | Off | Starts scroll capture with automatic scrolling (needs Accessibility). | scrollAutoScrollEnabled |
| Scroll speed | Slow · Medium · **Fast** · Very fast | Auto-scroll speed; enabled only with Auto-scroll on. | scrollAutoScrollSpeed |
| Max height | 0–100,000 px in steps of 5,000, **30,000** (0 = unlimited) | Upper limit for the stitched image. | scrollMaxHeight |
| Detect fixed/sticky headers | On | Keeps sticky headers and footers from repeating in the stitch. | scrollFrozenDetection |

### Uploads tab (not in Offline)

| Setting | Options · default | What it does | Stored as |
| --- | --- | --- | --- |
| Provider | **imgbb (images only)** · Google Drive (images + videos) · S3-Compatible (images + videos) | Destination for the Upload action. | uploadProvider |
| Google Drive ▸ Account | Sign In with Google / Sign Out | OAuth sign-in; shows your email when signed in. | (token) |
| Google Drive ▸ Folder | empty = “macshot” | Drive folder for uploads. macshot only reuses folders it created; uploads stay private. | gdriveFolderName |
| S3 ▸ Endpoint | e.g. R2 endpoint URL | S3-compatible API endpoint. | s3Endpoint |
| S3 ▸ Region | **auto** | Signing region. | s3Region |
| S3 ▸ Bucket | — | Target bucket. | s3Bucket |
| S3 ▸ Access Key / Secret Key | — | Credentials (secret field is masked). | s3AccessKeyID s3SecretAccessKey |
| S3 ▸ Public URL | e.g. CDN base URL | Base of the link copied after upload; empty uses the endpoint URL. | s3PublicURLBase |
| S3 ▸ Path Prefix | e.g. `screenshots/{year}/{month}/{day}/` | Object key prefix with date placeholders (example expansion shown). | s3PathPrefix |
| S3 ▸ Make uploads publicly readable | Off | Sends the public-read ACL. Needed for AWS S3, DigitalOcean Spaces, MinIO, Backblaze B2; leave off for Cloudflare R2. | s3PublicRead |
| S3 ▸ Test Connection | — | Uploads a tiny test file and shows success or the error. | — |
| imgbb ▸ API key | empty = shared key | Your own key if you hit rate limits. Images only. | imgbbAPIKey |
| Upload History | — | Past imgbb uploads, each with a URL row and a DEL (delete link) row, each with Copy. | imgbbUploads |

### About tab

App icon, name, “Version x (build)”, a short description, the Offline note (Offline build only), “Licensed under the GPLv3”, and **Copy Screen Info** (macOS 14+), which copies display and capture diagnostics (screen frames, scale, colour spaces, ScreenCaptureKit image formats) to the clipboard for bug reports.

## App menus (File / Edit)

macOS menu bar at the top of the screen, visible while an editor or Settings window is active

| Menu ▸ item | Shortcut | What it does |
| --- | --- | --- |
| macshot ▸ About macshot | — | Standard About panel. |
| macshot ▸ Quit macshot | ⌘Q | Quits (inside Settings, ⌘Q only closes Settings). |
| File ▸ Open... | ⌘O | Opens an image or `.macshot` project in the Editor. |
| File ▸ Close Window | ⌘W | Closes the front window. |
| File ▸ Save Project | ⇧⌘S | Saves the front Editor as an editable `.macshot` project. |
| File ▸ Save Project As... | ⌥⇧⌘S | Saves the project under a new name. |
| Edit ▸ Undo / Redo | ⌘Z / ⌘⇧Z | Follows the Undo/Redo shortcuts set in Settings. |
| Edit ▸ Cut / Copy / Paste / Delete / Select All | ⌘X ⌘C ⌘V — ⌘A | Standard text editing (text boxes, fields). |

## Keyboard reference

| Context | Keys |
| --- | --- |
| Overlay, before selecting | Tab snap mode · F full screen · R last selection · Space move while dragging · Shift constrain · Esc cancel |
| Overlay, after selecting | Enter quick action · ⌘C copy · ⌘S save · ⌘Z/⌘⇧Z undo/redo · ⌘V paste image or annotations · ⌘D duplicate · arrows nudge · Delete remove · ⌘0 reset zoom · tool keys (see Settings ▸ Shortcuts) · Measure: hold 1/2 · ⌥ bypass edge snap |
| Recording setup | Esc cancel · Space move selection |
| Scroll capture | Enter stop · ⌘C stop and copy · Esc cancel |
| Editor window | ⌘0 100% · ⌘+/⌘= zoom in · ⌘− zoom out · ⌘1 fit · ⇧⌘S save project · ⌥⇧⌘S save project as · ⌘W close |
| Studio video editor | Space play/pause · ←/→ one frame (Shift = 1 s) · Home/End go to trim start/end · I/O set trim in/out · Z add zoom · C add cut · T add text · J back \~1 s · K pause · L play · =/− timeline zoom · Delete remove selection · Esc cancel export / leave crop / deselect · ⌘S save · ⌘⇧S save as · ⌘C copy · ⌘E export |
| History panel | ←/→ select · Return copy · Space Quick Look · Delete delete · ⌘E editor · Esc close |
| Pinned image | Esc close |
| OCR window | ⌘↩ copy text |

## URL scheme

Settings ▸ General ▸ Enable macshot:// URL scheme (ⓘ shows this list)

| URL | What it does |
| --- | --- |
| `macshot://capture` | Start area capture. |
| `macshot://capture-fullscreen` | Capture the full screen. |
| `macshot://capture-last` | Re-capture the last selected area. |
| `macshot://quick-capture` | Quick capture (uses your Enter action). |
| `macshot://ocr` | Capture an area and read text/QR codes. |
| `macshot://ocr-translate?target=zh-CN` | Capture, translate, and overlay the text on the image. |
| `macshot://record` | Start area recording. |
| `macshot://record-fullscreen` | Start full-screen recording. |
| `macshot://stop-recording` | Stop the current recording. |
| `macshot://scroll-capture` | Start scroll capture. |
| `macshot://history` | Open the recent captures overlay. |
| `macshot://settings` | Open Settings. |
| `macshot://open?file=/path.png` | Open an image file in the Editor. |
| `macshot://edit?id=<id>` | Open a history entry in the Editor with annotations editable. |

## Permissions

| Permission | Needed for |
| --- | --- |
| Screen Recording | All captures and recordings (required). |
| Accessibility | Element snap mode and scroll capture auto-scroll. |
| Input Monitoring | Click highlights and keystroke display during recording. |
| Microphone | Recording a microphone track. |
| Camera | Webcam overlay. |
| Speech recognition (on-device) | Studio captions. |

## Preferences set outside Settings

These persist between captures but are changed from the overlay, not the Settings window.

| Preference | Where it is changed | Stored as |
| --- | --- | --- |
| Confirm before upload | Right-click the Upload button | uploadConfirmEnabled |
| Keystroke mode (Shortcuts Only / All Keystrokes) | Right-click Show Keystrokes | keystrokeShowAll |
| Microphone on/off and device | Mic button and its right-click menu | recordMicAudio selectedMicDeviceUID |
| System audio, click highlights, keystrokes, webcam | Recording toolbar toggles | recordSystemAudio, recordMouseHighlight, recordKeystroke, recordWebcam |
| Censor mode | Censor tool options | censorMode |
| Arrow direction, pencil pressure, smart marker | Tool options row | arrowReversed, pencilPressureEnabled, smartMarkerEnabled |
| PII types | Censor ▸ Auto: PII ▾ | one key per type |
| Beautify style and sliders | Beautify options row | beautify\* |
| Capture delay | Menu ▸ Capture Delay | captureDelaySeconds |
| Kept aspect ratio | Presets popover ▸ Keep ratio for next captures | — |

## Notes & discrepancies

Places where the README or the Settings UI differ from what the code does at this commit.

- **Auto-Redact toggle has no button.** Settings ▸ Tools ▸ Right Toolbar Actions lists “Auto-Redact sensitive data”, but the toolbar builder returns no button for it. Auto-redaction is reached through the Censor tool’s **Auto:** buttons, so this checkbox currently changes nothing visible.
- **README key table is out of date.** It lists S as “Select & Edit”. In code, V is Select & Move and S is Auto-Adjust Selection. The README also omits F = Pin, U = Upload and Space = Move Selection after a selection exists.
- **Gradient count.** The README mentions 7 mesh gradients; the code defines 18 mesh gradients for macOS 15+ in addition to the linear styles.
- **Quick emojis.** The README says 21; the stamp tool row has 17.
- **Recording FPS lists differ.** Settings offers 15/24/30/60/120 fps; the per-recording gear popover offers 15/30/60/120.
- **Pin context menu** titles (“Copy to Clipboard”, “Save As...”, “Close”) are not passed through translation, unlike the rest of the UI.

Everything here comes from reading the source at commit b7655ba. It was not checked against a running copy of macshot, because the analysis box runs Linux. Visual details (exact placement, colours, icon shapes) and behaviour that depends on macOS version or permissions should be confirmed on a Mac.