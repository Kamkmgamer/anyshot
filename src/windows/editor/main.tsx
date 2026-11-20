import '../common/ui.css';
import './editor.css';
import { render } from 'preact';
import { beautifiedSize, beautifyBackgroundCss } from '../../engine/beautify';
import { isBlankDoc, parseDoc, translateDoc } from '../../engine/document';
import { type Beautify, type Doc, emptyDoc } from '../../engine/model';
import { type Rect, rectFromPoints } from '../../shared/geometry';
import type { DeliverAction, EditableSource, EditorInit, EncodedImage } from '../../shared/ipc';
import { packProject } from '../../shared/project';
import { isRecord } from '../../shared/schema';
import { type Annotator, createAnnotator, nativeInputOwnsKey } from '../common/annotator';
import { EffectButtons, EffectPopovers } from '../common/effects-ui';
import { TextPopover } from '../common/text-style-ui';
import { exportImage } from '../common/export';
import { createStore, useStore } from '../common/store';
import { followTheme } from '../common/theme';
import { Bar, Button, ColorPopover, OptionsRow, RepeatButton, ToolStrip } from '../common/toolbar';
import { SaveSplitButton } from './save-menu';
import { modeForShortcut, type SaveMode } from './save-mode';

const api = window.anyshot;

interface EditorUi {
  zoom: number;
  title: string;
  dirty: boolean;
  cropping: boolean;
  busy: boolean;
  status: string | null;
  crop: Rect | null;
  saveMode: SaveMode;
}

const ui = createStore<EditorUi>({
  zoom: 1,
  title: '',
  dirty: false,
  cropping: false,
  busy: false,
  status: null,
  crop: null,
  saveMode: 'replace',
});

const viewport = el('viewport');
const frame = el('frame');
const clip = el('clip');
const stage = el('stage');
const cropLayer = el('crop');
const cropBox = el('crop-box');

let init: EditorInit;
let bitmap: ImageBitmap;
let annotator: Annotator;
let size = { width: 1, height: 1 };
let savedDoc: Doc;
let historyId: string | null = null;
let cropDraft: Rect | null = null;

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node;
}

const unit = () => annotator.docs.doc.unit;
/** CSS pixels per image pixel. Zoom 1 shows the image at its captured size. */
const scale = () => ui.get().zoom / unit();

/** The part of the image currently shown and exported. */
function visibleRegion(): Rect {
  const crop = ui.get().cropping ? null : annotator.docs.doc.crop;
  return crop ?? { x: 0, y: 0, ...size };
}

function layout(): void {
  const s = scale();
  const region = visibleRegion();
  Object.assign(clip.style, { width: `${region.width * s}px`, height: `${region.height * s}px` });
  Object.assign(stage.style, {
    width: `${size.width * s}px`,
    height: `${size.height * s}px`,
    transform: `translate(${-region.x * s}px, ${-region.y * s}px)`,
  });
  paintCropBox();
  paintFrame();
}

/** Beautify as it will be exported: committed, or being dragged in the popover. */
function shownBeautify(): Beautify | null {
  if (ui.get().cropping) return null;
  const tools = annotator.controller.store.get();
  const b = (tools.previewEffects ?? annotator.docs.doc.effects).beautify;
  return b.enabled ? b : null;
}

/**
 * Shows the Beautify frame live around the image with CSS: the same gradient,
 * padding, corner radius and shadow drawBeautified adds on export, at the
 * current zoom. The canvas and its coordinates stay as they are.
 */
function paintFrame(): void {
  const b = shownBeautify();
  frame.classList.toggle('beautified', b !== null);
  frame.dataset.background = b ? String(b.background) : '';
  if (!b) {
    frame.style.padding = '';
    frame.style.background = '';
    clip.style.borderRadius = '';
    clip.style.boxShadow = '';
    return;
  }
  const s = scale();
  const region = visibleRegion();
  const pad = beautifiedSize(region.width, region.height, b, unit()).pad * s;
  const width = region.width * s + pad * 2;
  const height = region.height * s + pad * 2;
  const shadow = b.shadow * unit() * s;
  frame.style.padding = `${pad}px`;
  frame.style.background = beautifyBackgroundCss(b, width, height);
  clip.style.borderRadius = `${b.radius * unit() * s}px`;
  clip.style.boxShadow =
    shadow > 0 ? `0 ${shadow * 0.25}px ${shadow}px rgba(0, 0, 0, 0.45)` : 'none';
}

function fitZoom(): number {
  const region = visibleRegion();
  const b = shownBeautify();
  // Image pixels the frame adds on each side; zoom scales them with the image.
  const pad = b ? beautifiedSize(region.width, region.height, b, unit()).pad : 0;
  const available = { width: viewport.clientWidth - 48, height: viewport.clientHeight - 48 };
  const fit =
    Math.min(
      available.width / (region.width + pad * 2),
      available.height / (region.height + pad * 2),
    ) * unit();
  return Math.max(0.1, Math.min(1, fit));
}

function setZoom(zoom: number): void {
  ui.set({ zoom: Math.min(8, Math.max(0.1, zoom)) });
  layout();
}

const ZOOM_STEP = 1.25;
/** Reads the current zoom, so held buttons keep stepping from the latest value. */
const zoomBy = (factor: number) => setZoom(ui.get().zoom * factor);

// ---------------------------------------------------------------- crop

function startCrop(): void {
  annotator.view.commitText();
  cropDraft = annotator.docs.doc.crop ?? { x: 0, y: 0, ...size };
  ui.set({ cropping: true });
  cropLayer.hidden = false;
  layout();
}

function endCrop(apply: boolean): void {
  const draft = cropDraft;
  cropDraft = null;
  cropLayer.hidden = true;
  ui.set({ cropping: false });
  if (apply && draft && draft.width >= 2 && draft.height >= 2) {
    const full =
      draft.x <= 0 && draft.y <= 0 && draft.width >= size.width && draft.height >= size.height;
    annotator.docs.setCrop(full ? null : roundRect(draft));
  }
  layout();
}

function roundRect(r: Rect): Rect {
  const x = Math.max(0, Math.round(r.x));
  const y = Math.max(0, Math.round(r.y));
  return {
    x,
    y,
    width: Math.min(size.width, Math.round(r.x + r.width)) - x,
    height: Math.min(size.height, Math.round(r.y + r.height)) - y,
  };
}

function paintCropBox(): void {
  if (!cropDraft) return;
  const s = scale();
  Object.assign(cropBox.style, {
    left: `${cropDraft.x * s}px`,
    top: `${cropDraft.y * s}px`,
    width: `${cropDraft.width * s}px`,
    height: `${cropDraft.height * s}px`,
  });
}

// Any of these ends a crop drag; pointercancel comes without a pointerup.
const CROP_DRAG_END = ['pointerup', 'pointercancel', 'lostpointercapture'] as const;

cropLayer.addEventListener('pointerdown', (e) => {
  const start = annotator.view.toImage(e.clientX, e.clientY);
  cropLayer.setPointerCapture(e.pointerId);
  const move = (m: PointerEvent) => {
    if (m.pointerId !== e.pointerId) return;
    const p = annotator.view.toImage(m.clientX, m.clientY);
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
    cropDraft = rectFromPoints(start, { x: clamp(p.x, size.width), y: clamp(p.y, size.height) });
    paintCropBox();
  };
  const end = (m: PointerEvent) => {
    if (m.pointerId !== e.pointerId) return;
    cropLayer.removeEventListener('pointermove', move);
    for (const type of CROP_DRAG_END) cropLayer.removeEventListener(type, end);
  };
  cropLayer.addEventListener('pointermove', move);
  for (const type of CROP_DRAG_END) cropLayer.addEventListener(type, end);
});

// ---------------------------------------------------------------- output

async function exportCurrent(withSaveFormat: boolean) {
  annotator.view.commitText();
  const region = annotator.docs.doc.crop ?? { x: 0, y: 0, ...size };
  const doc = translateDoc({ ...annotator.docs.doc, crop: null }, -region.x, -region.y);
  const settings = init.settings;
  const format = settings.output.imageFormat;
  return exportImage({
    source: bitmap,
    region,
    doc,
    ...(withSaveFormat && format !== 'png'
      ? {
          save: {
            mime: format === 'jpeg' ? ('image/jpeg' as const) : ('image/webp' as const),
            quality: settings.output.imageQuality,
          },
        }
      : {}),
  });
}

/** The original pixels as PNG, encoded once: history and projects keep them with the document. */
let sourcePng: Promise<EncodedImage> | null = null;
function encodedSource(): Promise<EncodedImage> {
  if (!sourcePng) {
    const encoding = exportImage({ source: bitmap, region: { x: 0, y: 0, ...size }, thumbMax: 16 });
    sourcePng = encoding.then((out) => out.png);
    // A failed encode is tried again next time.
    encoding.catch(() => {
      sourcePng = null;
    });
  }
  return sourcePng;
}

/** What history needs to reopen the result editable; nothing for an unedited image. */
async function editableSource(doc: Doc): Promise<EditableSource | undefined> {
  return isBlankDoc(doc) ? undefined : { doc, source: await encodedSource() };
}

/**
 * Exports and hands the image to main; true when the action succeeded. The
 * result updates this editor's history entry, or with `asCopy` becomes a new
 * entry that the editor then works on.
 */
async function deliver(action: DeliverAction, label: string, asCopy = false): Promise<boolean> {
  if (ui.get().busy) return false;
  ui.set({ busy: true, status: null });
  try {
    annotator.view.commitText();
    const doc = annotator.docs.doc;
    const [out, edit] = await Promise.all([
      exportCurrent(action === 'save' || action === 'saveAs'),
      editableSource(doc),
    ]);
    const result = await api.invoke('capture:deliver', {
      action,
      image: out.png,
      thumb: out.thumb,
      quiet: true,
      ...(out.save ? { saveImage: out.save } : {}),
      ...(edit ? { edit } : {}),
      ...(historyId && !asCopy ? { historyId } : {}),
    });
    if (result.historyId) {
      historyId = result.historyId;
      // History now holds these edits (editable), so closing loses nothing.
      markSaved(doc);
    }
    if (result.ok) {
      const saved = asCopy ? 'Saved a copy' : 'Saved';
      ui.set({ status: result.path ? `${saved} to ${result.path}` : label });
    } else if (result.error !== 'cancelled') ui.set({ status: result.error ?? 'Failed' });
    return result.ok;
  } catch (error) {
    ui.set({ status: `Failed: ${String(error)}` });
    return false;
  } finally {
    ui.set({ busy: false });
  }
}

/** Saves an edited history capture over its entry or as a new one, and remembers the choice. */
function saveEdits(mode: SaveMode): void {
  if (ui.get().busy) return;
  if (ui.get().saveMode !== mode) {
    ui.set({ saveMode: mode });
    void api
      .invoke('settings:patch', { editor: { saveMode: mode } })
      .catch((error: unknown) =>
        console.error('[editor] could not remember the save choice', error),
      );
  }
  void deliver('save', 'Saved', mode === 'copy');
}

/** Records `doc` as written; edits made while it was being written stay unsaved. */
function markSaved(doc: Doc): void {
  savedDoc = doc;
  ui.set({ dirty: annotator.docs.doc !== doc });
  syncTitle();
}

/** Done (history edits): saves back to the entry, and closes only if that worked. */
async function finishHistoryEdit(): Promise<void> {
  annotator.view.commitText();
  const doc = annotator.docs.doc;
  if (!(await deliver('none', 'Saved to history'))) return;
  markSaved(doc);
  if (annotator.docs.doc === doc) void api.invoke('window:close');
}

async function saveProject(saveAs: boolean): Promise<void> {
  // Checked here too: the shortcut works while the toolbar buttons are disabled.
  if (ui.get().busy) return;
  annotator.view.commitText();
  const doc = annotator.docs.doc;
  ui.set({ busy: true, status: null });
  try {
    const source = await encodedSource();
    const bytes = packProject({
      doc,
      image: { mime: 'image/png', width: size.width, height: size.height },
      bytes: new Uint8Array(source.bytes),
    });
    const path = await api.invoke('editor:save-project', {
      bytes: bytes.buffer as ArrayBuffer,
      saveAs,
    });
    if (path) {
      ui.set({ title: path.split(/[\\/]/).pop() ?? path, status: `Project saved to ${path}` });
      markSaved(doc);
    }
  } catch (error) {
    ui.set({ status: `Project not saved: ${String(error)}` });
  } finally {
    ui.set({ busy: false });
  }
}

function syncTitle(): void {
  const { title, dirty } = ui.get();
  void api.invoke('editor:set-title', { title, dirty });
}

// ---------------------------------------------------------------- chrome

function TopBar() {
  const s = useStore(ui, (s) => ({
    zoom: s.zoom,
    title: s.title,
    cropping: s.cropping,
    busy: s.busy,
    crop: s.crop,
    saveMode: s.saveMode,
  }));
  const region = s.crop ?? { width: size.width, height: size.height };
  return (
    <>
      <span class="title">{s.title}</span>
      <span class="size" data-testid="editor-size">{`${region.width} × ${region.height}`}</span>
      <span class="sep" />
      <Button icon="open" label="Open (Ctrl+O)" onClick={() => void api.invoke('editor:open')} />
      <Button
        icon="crop"
        label="Crop (C)"
        active={s.cropping}
        onClick={() => (s.cropping ? endCrop(true) : startCrop())}
        testId="crop"
      />
      {s.cropping && (
        <span class="crop-bar">
          <button
            type="button"
            class="primary"
            data-testid="crop-apply"
            onClick={() => endCrop(true)}
          >
            Apply
          </button>
          <button type="button" onClick={() => endCrop(false)}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              cropDraft = { x: 0, y: 0, ...size };
              paintCropBox();
            }}
          >
            Reset
          </button>
        </span>
      )}
      <span class="spacer" />
      <RepeatButton
        icon="zoomOut"
        label="Zoom out (Ctrl+-)"
        onStep={() => zoomBy(1 / ZOOM_STEP)}
        testId="zoom-out"
      />
      <button
        type="button"
        class="zoom"
        title="Actual size (Ctrl+0)"
        data-testid="zoom-level"
        onClick={() => setZoom(1)}
      >
        {`${Math.round(s.zoom * 100)}%`}
      </button>
      <RepeatButton
        icon="zoomIn"
        label="Zoom in (Ctrl+=)"
        onStep={() => zoomBy(ZOOM_STEP)}
        testId="zoom-in"
      />
      <Button icon="fit" label="Fit (Ctrl+1)" onClick={() => setZoom(fitZoom())} />
      <span class="sep" />
      <Button
        icon="editor"
        label="Save project (Ctrl+Shift+S)"
        disabled={s.busy}
        onClick={() => void saveProject(false)}
        testId="save-project"
      />
      <Button
        icon="copy"
        label="Copy (Ctrl+C)"
        disabled={s.busy}
        onClick={() => void deliver('copy', 'Copied to the clipboard')}
        testId="editor-copy"
      />
      {init.historyId ? (
        <SaveSplitButton primary={s.saveMode} disabled={s.busy} onSave={saveEdits} />
      ) : (
        <Button
          icon="save"
          label="Save image (Ctrl+S)"
          disabled={s.busy}
          onClick={() => void deliver('save', 'Saved')}
          testId="editor-save"
        />
      )}
      <Button
        icon="pin"
        label="Pin to screen"
        disabled={s.busy}
        onClick={() => void deliver('pin', 'Pinned')}
      />
      {init.historyId && (
        <button
          type="button"
          class="done"
          disabled={s.busy}
          onClick={() => void finishHistoryEdit()}
        >
          Done
        </button>
      )}
    </>
  );
}

function Tools() {
  const status = useStore(ui, (s) => s.status);
  return (
    <>
      <Bar testId="tools">
        <ToolStrip c={annotator.controller} extra={<EffectButtons c={annotator.controller} />} />
      </Bar>
      <OptionsRow c={annotator.controller} />
      <ColorPopover c={annotator.controller} />
      <EffectPopovers c={annotator.controller} />
      <TextPopover c={annotator.controller} />
      {status && (
        <button
          type="button"
          class="toast"
          data-testid="editor-status"
          onClick={() => ui.set({ status: null })}
        >
          {status}
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------- input

function onKeyDown(e: KeyboardEvent): void {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod && e.key !== 'Escape' && nativeInputOwnsKey(e)) return;
  const key = e.key.toLowerCase();
  if (ui.get().cropping) {
    if (e.key === 'Enter') endCrop(true);
    else if (e.key === 'Escape') endCrop(false);
    return;
  }
  if (mod && key === 's') {
    if (e.shiftKey) void saveProject(e.altKey);
    else if (init.historyId) saveEdits(modeForShortcut(e.altKey, ui.get().saveMode));
    else void deliver('save', 'Saved');
  } else if (mod && key === 'c' && annotator.docs.selected.size === 0)
    void deliver('copy', 'Copied to the clipboard');
  else if (mod && key === 'o') void api.invoke('editor:open');
  else if (mod && key === 'w') void api.invoke('window:close');
  else if (mod && key === '0') setZoom(1);
  else if (mod && key === '1') setZoom(fitZoom());
  else if (mod && (key === '=' || key === '+')) zoomBy(ZOOM_STEP);
  else if (mod && key === '-') zoomBy(1 / ZOOM_STEP);
  else if (!mod && key === 'c') startCrop();
  else if (!annotator.handleKey(e)) return;
  e.preventDefault();
}

function wirePointer(): void {
  let active = false;
  viewport.addEventListener('pointerdown', (e) => {
    if (ui.get().cropping) return;
    // Measurements may start beside the image: they begin at its nearest edge.
    const onImage = e.target instanceof Node && stage.contains(e.target);
    const onScrollbar = e.offsetX >= viewport.clientWidth || e.offsetY >= viewport.clientHeight;
    if (!onImage && (onScrollbar || annotator.controller.store.get().tool !== 'measure')) return;
    if (!annotator.view.pointerDown(e)) return;
    active = true;
    viewport.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  viewport.addEventListener('pointermove', (e) => {
    if (active) annotator.view.pointerMove(e);
  });
  const up = (e: PointerEvent) => {
    if (!active) return;
    active = false;
    annotator.view.pointerUp(e);
  };
  viewport.addEventListener('pointerup', up);
  viewport.addEventListener('pointercancel', up);
  viewport.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(ui.get().zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    },
    { passive: false },
  );
}

// ---------------------------------------------------------------- boot

function fitsImage(r: Rect): boolean {
  return (
    [r.x, r.y, r.width, r.height].every(Number.isInteger) &&
    r.x >= 0 &&
    r.y >= 0 &&
    r.width >= 1 &&
    r.height >= 1 &&
    r.x + r.width <= size.width &&
    r.y + r.height <= size.height
  );
}

async function loadSource(source: EditorInit['source']): Promise<ImageBitmap> {
  if (source.kind === 'frame') {
    const response = await fetch(`/@frame/${source.frameId}`);
    const pixels = new Uint8ClampedArray(await response.arrayBuffer());
    const image = await createImageBitmap(new ImageData(pixels, source.width, source.height));
    void api.invoke('frame:release', source.frameId);
    return image;
  }
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`Could not load the image (${response.status})`);
  return createImageBitmap(await response.blob());
}

async function boot(): Promise<void> {
  init = await api.invoke('editor:init');
  followTheme(init.settings);
  historyId = init.historyId;
  bitmap = await loadSource(init.source);
  size = { width: bitmap.width, height: bitmap.height };
  const doc = init.doc ? parseDoc(init.doc) : emptyDoc(1);
  const hasSavedCrop = isRecord(init.doc) && init.doc.crop != null;
  if (hasSavedCrop && (!doc.crop || !fitsImage(doc.crop))) {
    bitmap.close();
    document.body.textContent = 'anyshot could not open this project because its crop is invalid.';
    return;
  }
  annotator = createAnnotator(stage, size, doc, init.settings);
  annotator.view.setSource(bitmap);
  savedDoc = annotator.docs.doc;
  const tools = annotator.controller.store;
  tools.set({ framePreview: true });
  let shown = { effects: tools.get().effects, preview: tools.get().previewEffects };
  tools.subscribe((t) => {
    if (t.effects === shown.effects && t.previewEffects === shown.preview) return;
    shown = { effects: t.effects, preview: t.previewEffects };
    paintFrame();
  });
  annotator.docs.subscribe((next) => {
    const dirty = next !== savedDoc;
    if (dirty !== ui.get().dirty) {
      ui.set({ dirty });
      syncTitle();
    }
    if (next.crop !== ui.get().crop) {
      ui.set({ crop: next.crop });
      layout();
    }
  });
  ui.set({ title: init.title, crop: doc.crop, saveMode: init.settings.editor.saveMode });
  render(<TopBar />, el('top'));
  render(<Tools />, el('tools'));
  wirePointer();
  window.addEventListener('keydown', onKeyDown);
  ui.set({ zoom: fitZoom() });
  layout();
  window.addEventListener('resize', () => layout());
}

boot().catch((error) => {
  console.error('[editor] failed to start', error);
  document.body.textContent = `anyshot could not open this image: ${String(error)}`;
});
