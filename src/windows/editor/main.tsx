import '../common/ui.css';
import './editor.css';
import { render } from 'preact';
import { parseDoc, translateDoc } from '../../engine/document';
import { type Doc, emptyDoc } from '../../engine/model';
import { type Rect, rectFromPoints } from '../../shared/geometry';
import type { DeliverAction, EditorInit } from '../../shared/ipc';
import { packProject } from '../../shared/project';
import { type Annotator, createAnnotator } from '../common/annotator';
import { exportImage } from '../common/export';
import { createStore, useStore } from '../common/store';
import { applyTheme } from '../common/theme';
import { Bar, Button, ColorPopover, OptionsRow, ToolStrip } from '../common/toolbar';

const api = window.anyshot;

interface EditorUi {
  zoom: number;
  title: string;
  dirty: boolean;
  cropping: boolean;
  busy: boolean;
  status: string | null;
  crop: Rect | null;
}

const ui = createStore<EditorUi>({
  zoom: 1,
  title: '',
  dirty: false,
  cropping: false,
  busy: false,
  status: null,
  crop: null,
});

const viewport = el('viewport');
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
}

function fitZoom(): number {
  const region = visibleRegion();
  const available = { width: viewport.clientWidth - 48, height: viewport.clientHeight - 48 };
  const fit = Math.min(available.width / region.width, available.height / region.height) * unit();
  return Math.max(0.1, Math.min(1, fit));
}

function setZoom(zoom: number): void {
  ui.set({ zoom: Math.min(8, Math.max(0.1, zoom)) });
  layout();
}

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

cropLayer.addEventListener('pointerdown', (e) => {
  const start = annotator.view.toImage(e.clientX, e.clientY);
  cropLayer.setPointerCapture(e.pointerId);
  const move = (m: PointerEvent) => {
    const p = annotator.view.toImage(m.clientX, m.clientY);
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
    cropDraft = rectFromPoints(start, { x: clamp(p.x, size.width), y: clamp(p.y, size.height) });
    paintCropBox();
  };
  const up = () => {
    cropLayer.removeEventListener('pointermove', move);
    cropLayer.removeEventListener('pointerup', up);
  };
  cropLayer.addEventListener('pointermove', move);
  cropLayer.addEventListener('pointerup', up);
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

async function deliver(action: DeliverAction, label: string): Promise<void> {
  if (ui.get().busy) return;
  ui.set({ busy: true, status: null });
  try {
    const out = await exportCurrent(action === 'save' || action === 'saveAs');
    const result = await api.invoke('capture:deliver', {
      action,
      image: out.png,
      thumb: out.thumb,
      quiet: true,
      ...(out.save ? { saveImage: out.save } : {}),
      ...(historyId ? { historyId } : {}),
    });
    if (result.historyId) historyId = result.historyId;
    if (result.ok) ui.set({ status: result.path ? `Saved to ${result.path}` : label });
    else if (result.error !== 'cancelled') ui.set({ status: result.error ?? 'Failed' });
  } catch (error) {
    ui.set({ status: `Failed: ${String(error)}` });
  } finally {
    ui.set({ busy: false });
  }
}

async function saveProject(saveAs: boolean): Promise<void> {
  annotator.view.commitText();
  ui.set({ busy: true });
  try {
    const base = await exportImage({
      source: bitmap,
      region: { x: 0, y: 0, ...size },
      thumbMax: 16,
    });
    const bytes = packProject({
      doc: annotator.docs.doc,
      image: { mime: 'image/png', width: size.width, height: size.height },
      bytes: new Uint8Array(base.png.bytes),
    });
    const path = await api.invoke('editor:save-project', {
      bytes: bytes.buffer as ArrayBuffer,
      saveAs,
    });
    if (path) {
      savedDoc = annotator.docs.doc;
      ui.set({
        dirty: false,
        title: path.split(/[\\/]/).pop() ?? path,
        status: `Project saved to ${path}`,
      });
      syncTitle();
    }
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
      <Button icon="zoomOut" label="Zoom out (Ctrl+-)" onClick={() => setZoom(s.zoom / 1.25)} />
      <button type="button" class="zoom" title="Actual size (Ctrl+0)" onClick={() => setZoom(1)}>
        {`${Math.round(s.zoom * 100)}%`}
      </button>
      <Button icon="zoomIn" label="Zoom in (Ctrl+=)" onClick={() => setZoom(s.zoom * 1.25)} />
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
      <Button
        icon="save"
        label="Save image (Ctrl+S)"
        disabled={s.busy}
        onClick={() => void deliver('save', 'Saved')}
        testId="editor-save"
      />
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
          onClick={async () => {
            await deliver('none', 'Saved to history');
            savedDoc = annotator.docs.doc;
            ui.set({ dirty: false });
            syncTitle();
            void api.invoke('window:close');
          }}
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
        <ToolStrip c={annotator.controller} />
      </Bar>
      <OptionsRow c={annotator.controller} />
      <ColorPopover c={annotator.controller} />
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
  const key = e.key.toLowerCase();
  if (ui.get().cropping) {
    if (e.key === 'Enter') endCrop(true);
    else if (e.key === 'Escape') endCrop(false);
    return;
  }
  if (mod && key === 's') void (e.shiftKey ? saveProject(e.altKey) : deliver('save', 'Saved'));
  else if (mod && key === 'c' && annotator.docs.selected.size === 0)
    void deliver('copy', 'Copied to the clipboard');
  else if (mod && key === 'o') void api.invoke('editor:open');
  else if (mod && key === 'w') void api.invoke('window:close');
  else if (mod && key === '0') setZoom(1);
  else if (mod && key === '1') setZoom(fitZoom());
  else if (mod && (key === '=' || key === '+')) setZoom(ui.get().zoom * 1.25);
  else if (mod && key === '-') setZoom(ui.get().zoom / 1.25);
  else if (!mod && key === 'c') startCrop();
  else if (e.key === 'Escape' && annotator.controller.store.get().popover)
    annotator.controller.store.set({ popover: null });
  else if (!annotator.handleKey(e)) return;
  e.preventDefault();
}

function wirePointer(): void {
  let active = false;
  stage.addEventListener('pointerdown', (e) => {
    if (ui.get().cropping || !annotator.view.pointerDown(e)) return;
    active = true;
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stage.addEventListener('pointermove', (e) => {
    if (active) annotator.view.pointerMove(e);
  });
  const up = (e: PointerEvent) => {
    if (!active) return;
    active = false;
    annotator.view.pointerUp(e);
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
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
  applyTheme(init.settings);
  historyId = init.historyId;
  bitmap = await loadSource(init.source);
  size = { width: bitmap.width, height: bitmap.height };
  const doc = init.doc ? parseDoc(init.doc) : emptyDoc(1);
  annotator = createAnnotator(stage, size, doc, init.settings);
  annotator.view.setSource(bitmap);
  savedDoc = annotator.docs.doc;
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
  ui.set({ title: init.title, crop: doc.crop });
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
