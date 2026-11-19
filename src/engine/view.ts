import { distance, type Point, rectFromPoints, snap45, squareFrom } from '../shared/geometry';
import type { ToolId } from '../shared/settings';
import type { DocStore } from './document';
import { GlEffects } from './gl';
import {
  type Annotation,
  type CensorMode,
  type FillMode,
  isAdjustNeutral,
  type LineStyle,
  newId,
  type Stroke,
  type TextAnnotation,
} from './model';
import {
  type Ctx,
  censorFallback,
  drawAnnotation,
  drawAnnotations,
  type RenderEnv,
} from './render';
import {
  bounds,
  dragHandle,
  type HandleId,
  handles,
  setTextMeasurer,
  textFont,
  topmostAt,
  translate,
} from './shapes';

export interface ToolOptions {
  tool: ToolId;
  color: string;
  strokeWidth: number;
  fill: FillMode;
  lineStyle: LineStyle;
  textSize: number;
  censorMode: CensorMode;
  /** 10–95 percent. */
  spotlightDim: number;
  magnifyZoom: number;
  stampSize: number;
  stamp: string;
}

export interface ViewEvents {
  /** The colour picker tool sampled a pixel. */
  onPickColor?(hex: string, copy: boolean): void;
  /** Coarse state changed: selection, undo availability. */
  onStateChange?(): void;
}

type Interaction =
  | { type: 'idle' }
  | { type: 'draw'; start: Point; draft: Annotation }
  | { type: 'move'; start: Point; originals: Annotation[]; delta: Point }
  | { type: 'handle'; original: Annotation; handle: HandleId; current: Annotation };

const HANDLE_RADIUS_CSS = 6;

/**
 * The annotation surface: three stacked canvases (static image, committed
 * annotations, interaction) driven by pointer input. Plain TypeScript; the UI
 * framework only talks to it through methods and coarse callbacks.
 */
export class CanvasView {
  readonly base: HTMLCanvasElement;
  readonly committed: HTMLCanvasElement;
  readonly interaction: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private readonly committedCtx: CanvasRenderingContext2D;
  private readonly interactionCtx: CanvasRenderingContext2D;
  private source: ImageBitmap | null = null;
  private state: Interaction = { type: 'idle' };
  private dirty = { base: false, committed: false, interaction: false };
  private frame = 0;
  private skip = new Set<string>();
  private textEditor: HTMLTextAreaElement | null = null;
  private readonly gl = GlEffects.create();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly container: HTMLElement,
    private width: number,
    private height: number,
    readonly store: DocStore,
    private readonly options: () => ToolOptions,
    private readonly events: ViewEvents = {},
  ) {
    this.base = this.layer('base');
    this.committed = this.layer('committed');
    this.interaction = this.layer('interaction');
    this.baseCtx = context(this.base, { alpha: false, willReadFrequently: false });
    this.committedCtx = context(this.committed);
    this.interactionCtx = context(this.interaction);
    setTextMeasurer((text, font) => {
      this.interactionCtx.font = font;
      return this.interactionCtx.measureText(text).width;
    });
    this.unsubscribe = store.subscribe(() => {
      this.invalidate('committed', 'interaction');
      this.events.onStateChange?.();
    });
  }

  private layer(name: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.className = `layer layer-${name}`;
    canvas.width = this.width;
    canvas.height = this.height;
    this.container.appendChild(canvas);
    return canvas;
  }

  get unit(): number {
    return this.store.doc.unit;
  }

  /** Image pixels per CSS pixel as currently displayed. */
  get displayScale(): number {
    return this.width / Math.max(1, this.base.getBoundingClientRect().width);
  }

  setSource(bitmap: ImageBitmap): void {
    this.source = bitmap;
    this.invalidate('base', 'committed');
  }

  /** Resizes every layer (editor crop/flip produce a new source of a new size). */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    for (const c of [this.base, this.committed, this.interaction]) {
      c.width = width;
      c.height = height;
    }
    this.invalidate('base', 'committed', 'interaction');
  }

  toImage(clientX: number, clientY: number): Point {
    const r = this.base.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * this.width,
      y: ((clientY - r.top) / r.height) * this.height,
    };
  }

  invalidate(...layers: (keyof typeof this.dirty)[]): void {
    for (const l of layers) this.dirty[l] = true;
    if (!this.frame) this.frame = requestAnimationFrame(() => this.paint());
  }

  private env(): RenderEnv {
    return {
      source: this.base,
      width: this.width,
      height: this.height,
      unit: this.unit,
      censor: this.gl ? (c, s, a) => this.gl?.censor(c, s, a) : censorFallback,
    };
  }

  private paint(): void {
    this.frame = 0;
    if (this.dirty.base) this.paintBase();
    if (this.dirty.committed) {
      const ctx = this.committedCtx;
      ctx.clearRect(0, 0, this.width, this.height);
      drawAnnotations(ctx, this.store.doc.annotations, this.env(), this.skip);
    }
    if (this.dirty.interaction) this.paintInteraction();
    this.dirty = { base: false, committed: false, interaction: false };
  }

  private paintBase(): void {
    const ctx = this.baseCtx;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this.source) return;
    const { adjust, invert } = this.store.doc.effects;
    if (this.gl && (invert || !isAdjustNeutral(adjust))) {
      ctx.drawImage(this.gl.adjust(this.source, this.width, this.height, adjust, invert), 0, 0);
    } else {
      ctx.drawImage(this.source, 0, 0);
    }
  }

  private paintInteraction(): void {
    const ctx = this.interactionCtx;
    ctx.clearRect(0, 0, this.width, this.height);
    const s = this.state;
    if (s.type === 'draw') drawAnnotation(ctx, s.draft, this.env());
    if (s.type === 'move') {
      for (const a of s.originals)
        drawAnnotation(ctx, translate(a, s.delta.x, s.delta.y), this.env());
    }
    if (s.type === 'handle') drawAnnotation(ctx, s.current, this.env());
    this.paintSelection(ctx);
  }

  private paintSelection(ctx: Ctx): void {
    const scale = this.displayScale;
    const selected = this.selectedAnnotations();
    for (const a of selected) {
      const shown =
        this.state.type === 'move'
          ? translate(a, this.state.delta.x, this.state.delta.y)
          : this.state.type === 'handle' && this.state.original.id === a.id
            ? this.state.current
            : a;
      const b = bounds(shown);
      const pad = 4 * scale;
      ctx.save();
      ctx.lineWidth = 1.5 * scale;
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([5 * scale, 4 * scale]);
      ctx.strokeRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineDashOffset = 4.5 * scale;
      ctx.strokeRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
      ctx.setLineDash([]);
      for (const h of handles(shown)) {
        ctx.beginPath();
        ctx.arc(h.at.x, h.at.y, HANDLE_RADIUS_CSS * scale * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1.5 * scale;
        ctx.strokeStyle = '#111111';
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private selectedAnnotations(): Annotation[] {
    const ids = this.store.selected;
    return this.store.doc.annotations.filter((a) => ids.has(a.id));
  }

  private stroke(): Stroke {
    const o = this.options();
    return { color: o.color, width: o.strokeWidth * this.unit, style: o.lineStyle };
  }

  /** Starts an interaction. Returns false if the view didn't take the event. */
  pointerDown(e: PointerEvent): boolean {
    if (e.button !== 0) return false;
    this.commitText();
    const p = this.toImage(e.clientX, e.clientY);
    const o = this.options();
    const tolerance = 6 * this.displayScale;

    // Handles of selected annotations win over everything else.
    for (const a of this.selectedAnnotations()) {
      const h = handles(a).find(
        (h) => distance(h.at, p) <= HANDLE_RADIUS_CSS * 1.6 * this.displayScale,
      );
      if (h) {
        this.state = { type: 'handle', original: a, handle: h.id, current: a };
        this.skipIds([a.id]);
        return true;
      }
    }

    if (o.tool === 'select') {
      const hit = topmostAt(this.store.doc.annotations, p, tolerance);
      if (!hit) {
        this.store.select([]);
        return true;
      }
      if (!this.store.selected.has(hit.id))
        this.store.select(e.shiftKey ? [...this.store.selected, hit.id] : [hit.id]);
      const originals = this.selectedAnnotations();
      this.state = { type: 'move', start: p, originals, delta: { x: 0, y: 0 } };
      this.skipIds(originals.map((a) => a.id));
      return true;
    }

    if (this.store.selected.size > 0) this.store.select([]);

    switch (o.tool) {
      case 'text': {
        const hit = topmostAt(this.store.doc.annotations, p, tolerance);
        this.openTextEditor(hit?.kind === 'text' ? hit : null, p);
        return true;
      }
      case 'number': {
        const value =
          Math.max(
            0,
            ...this.store.doc.annotations.map((a) => (a.kind === 'number' ? a.value : 0)),
          ) + 1;
        this.store.add({
          id: newId(),
          kind: 'number',
          at: p,
          value,
          size: Math.max(22, o.strokeWidth * 7) * this.unit,
          color: o.color,
        });
        return true;
      }
      case 'stamp':
        this.store.add({
          id: newId(),
          kind: 'stamp',
          at: p,
          emoji: o.stamp,
          size: o.stampSize * this.unit,
        });
        return true;
      case 'picker':
        this.pickColor(p, e.shiftKey);
        return true;
      case 'magnify':
        this.state = {
          type: 'draw',
          start: p,
          draft: {
            id: newId(),
            kind: 'magnify',
            at: p,
            radius: 70 * this.unit,
            zoom: o.magnifyZoom,
            color: o.color,
          },
        };
        this.invalidate('interaction');
        return true;
      default: {
        const draft = this.newDraft(o.tool, p);
        if (!draft) return false;
        this.state = { type: 'draw', start: p, draft };
        this.invalidate('interaction');
        return true;
      }
    }
  }

  private newDraft(tool: ToolId, p: Point): Annotation | null {
    const o = this.options();
    const id = newId();
    const rect = { x: p.x, y: p.y, width: 0, height: 0 };
    switch (tool) {
      case 'pencil':
      case 'marker':
        return { id, kind: tool, points: [p], stroke: this.stroke() };
      case 'line':
      case 'arrow':
      case 'measure':
        return { id, kind: tool, a: p, b: p, stroke: this.stroke() };
      case 'rect':
      case 'ellipse':
        return {
          id,
          kind: tool,
          rect,
          stroke: this.stroke(),
          fill: o.fill,
          radius: tool === 'rect' ? 3 * this.unit : 0,
        };
      case 'censor':
        return { id, kind: 'censor', rect, mode: o.censorMode };
      case 'spotlight':
        return { id, kind: 'spotlight', rect, dim: o.spotlightDim / 100 };
      default:
        return null;
    }
  }

  pointerMove(e: PointerEvent): void {
    const s = this.state;
    if (s.type === 'idle') return;
    const p = this.toImage(e.clientX, e.clientY);
    if (s.type === 'draw') {
      const d = s.draft;
      if (d.kind === 'pencil' || d.kind === 'marker') {
        if (d.kind === 'marker' && e.shiftKey) {
          d.points = [s.start, p];
        } else {
          // Coalesced events give every sample the OS delivered for smooth strokes.
          const samples = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
          for (const c of samples.length > 0 ? samples : [e])
            d.points.push(this.toImage(c.clientX, c.clientY));
        }
      } else if (d.kind === 'line' || d.kind === 'arrow' || d.kind === 'measure') {
        d.b = e.shiftKey ? snap45(s.start, p) : p;
      } else if (
        d.kind === 'rect' ||
        d.kind === 'ellipse' ||
        d.kind === 'censor' ||
        d.kind === 'spotlight'
      ) {
        d.rect = rectFromPoints(s.start, e.shiftKey ? squareFrom(s.start, p) : p);
      } else if (d.kind === 'magnify') {
        d.radius = Math.max(70 * this.unit, distance(s.start, p));
      }
    } else if (s.type === 'move') {
      s.delta = { x: p.x - s.start.x, y: p.y - s.start.y };
    } else if (s.type === 'handle') {
      s.current = dragHandle(s.original, s.handle, p);
    }
    this.invalidate('interaction');
  }

  pointerUp(_e: PointerEvent): void {
    const s = this.state;
    this.state = { type: 'idle' };
    if (s.type === 'draw' && isMeaningful(s.draft, 3 * this.displayScale)) {
      this.store.add(s.draft);
    } else if (s.type === 'move' && (s.delta.x !== 0 || s.delta.y !== 0)) {
      const ids = new Set(s.originals.map((a) => a.id));
      const { delta } = s;
      this.unskip();
      this.store.updateSelected((a) => (ids.has(a.id) ? translate(a, delta.x, delta.y) : a));
      return;
    } else if (s.type === 'handle') {
      this.unskip();
      this.store.update(s.original, s.current);
      return;
    }
    this.unskip();
    this.invalidate('interaction');
  }

  get busy(): boolean {
    return this.state.type !== 'idle' || this.textEditor !== null;
  }

  /** Whether p (client px) is over an annotation or a selection handle. */
  hits(clientX: number, clientY: number): boolean {
    const p = this.toImage(clientX, clientY);
    if (
      this.selectedAnnotations().some((a) =>
        handles(a).some((h) => distance(h.at, p) <= HANDLE_RADIUS_CSS * 1.6 * this.displayScale),
      )
    ) {
      return true;
    }
    return topmostAt(this.store.doc.annotations, p, 6 * this.displayScale) !== undefined;
  }

  /** Keyboard handling for annotation edits. Returns true if the key was used. */
  keyDown(e: KeyboardEvent): boolean {
    if (this.textEditor) return false;
    const mod = e.ctrlKey || e.metaKey;
    const hasSelection = this.store.selected.size > 0;
    if ((e.key === 'Delete' || e.key === 'Backspace') && hasSelection) {
      this.store.removeSelected();
      return true;
    }
    if (mod && e.key.toLowerCase() === 'd' && hasSelection) {
      this.store.duplicateSelected(12 * this.unit, newId);
      return true;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      this.store.select(this.store.doc.annotations.map((a) => a.id));
      return true;
    }
    if (e.key === 'Escape' && hasSelection) {
      this.store.select([]);
      return true;
    }
    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
      e.key
    ];
    if (nudge && hasSelection) {
      const step = (e.shiftKey ? 10 : 1) * this.unit;
      const [dx = 0, dy = 0] = nudge;
      this.store.updateSelected((a) => translate(a, dx * step, dy * step));
      return true;
    }
    return false;
  }

  /** Applies style changes from the toolbar to selected annotations. */
  applyStyle(
    patch: Partial<Pick<ToolOptions, 'color' | 'strokeWidth' | 'lineStyle' | 'fill'>>,
  ): void {
    this.store.updateSelected((a) => restyle(a, patch, this.unit));
  }

  private skipIds(ids: string[]): void {
    this.skip = new Set(ids);
    this.invalidate('committed', 'interaction');
  }

  private unskip(): void {
    if (this.skip.size === 0) return;
    this.skip = new Set();
    this.invalidate('committed', 'interaction');
  }

  private pickColor(p: Point, copy: boolean): void {
    const x = Math.max(0, Math.min(this.width - 1, Math.floor(p.x)));
    const y = Math.max(0, Math.min(this.height - 1, Math.floor(p.y)));
    const [r = 0, g = 0, b = 0] = this.baseCtx.getImageData(x, y, 1, 1).data;
    const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    this.events.onPickColor?.(hex, copy);
  }

  private openTextEditor(existing: TextAnnotation | null, p: Point): void {
    const o = this.options();
    const size = existing?.size ?? o.textSize * this.unit;
    const at = existing?.at ?? { x: p.x, y: p.y - size * 0.6 };
    const color = existing?.color ?? o.color;
    const scale = 1 / this.displayScale;
    const editor = document.createElement('textarea');
    editor.className = 'text-editor';
    editor.value = existing?.text ?? '';
    editor.spellcheck = false;
    Object.assign(editor.style, {
      left: `${this.base.offsetLeft + at.x * scale}px`,
      top: `${this.base.offsetTop + at.y * scale}px`,
      font: textFont(size * scale),
      color,
      lineHeight: '1.25',
    });
    const fitToContent = () => {
      editor.style.height = 'auto';
      editor.style.height = `${editor.scrollHeight}px`;
      editor.style.width = 'auto';
      editor.style.width = `${Math.max(40, editor.scrollWidth + 8)}px`;
    };
    editor.addEventListener('input', fitToContent);
    editor.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.closeTextEditor(false);
      else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.closeTextEditor(true);
      }
    });
    editor.addEventListener('pointerdown', (e) => e.stopPropagation());
    editor.addEventListener('blur', () => this.closeTextEditor(true));
    this.container.appendChild(editor);
    this.textEditor = editor;
    this.textTarget = { existing, at, size, color };
    if (existing) this.skipIds([existing.id]);
    fitToContent();
    requestAnimationFrame(() => editor.focus());
  }

  private textTarget: {
    existing: TextAnnotation | null;
    at: Point;
    size: number;
    color: string;
  } | null = null;

  /** Commits any open text box (e.g. before exporting). */
  commitText(): void {
    if (this.textEditor) this.closeTextEditor(true);
  }

  private closeTextEditor(commit: boolean): void {
    const editor = this.textEditor;
    const target = this.textTarget;
    if (!editor || !target) return;
    this.textEditor = null;
    this.textTarget = null;
    const text = editor.value.replace(/\s+$/, '');
    editor.remove();
    this.unskip();
    if (!commit) return;
    const { existing } = target;
    if (existing) {
      if (!text)
        this.store.commit({
          type: 'remove',
          annotation: existing,
          index: this.store.doc.annotations.indexOf(existing),
        });
      else if (text !== existing.text) this.store.update(existing, { ...existing, text });
    } else if (text) {
      this.store.add({
        id: newId(),
        kind: 'text',
        at: target.at,
        text,
        size: target.size,
        color: target.color,
        background: false,
      });
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.unsubscribe();
    this.textEditor?.remove();
    for (const c of [this.base, this.committed, this.interaction]) {
      c.width = 0;
      c.height = 0;
      c.remove();
    }
    this.source = null;
  }
}

function context(canvas: HTMLCanvasElement, options?: CanvasRenderingContext2DSettings) {
  const ctx = canvas.getContext('2d', options);
  if (!ctx) throw new Error('2D canvas unavailable');
  return ctx;
}

/** Drafts too small to see are treated as accidental clicks. */
export function isMeaningful(a: Annotation, min: number): boolean {
  switch (a.kind) {
    case 'pencil':
    case 'marker':
      return a.points.length > 1;
    case 'line':
    case 'arrow':
    case 'measure':
      return distance(a.a, a.b) >= min;
    case 'rect':
    case 'ellipse':
    case 'censor':
    case 'spotlight':
      return a.rect.width >= min && a.rect.height >= min;
    default:
      return true;
  }
}

export function restyle(
  a: Annotation,
  patch: Partial<Pick<ToolOptions, 'color' | 'strokeWidth' | 'lineStyle' | 'fill'>>,
  unit: number,
): Annotation {
  if ('stroke' in a) {
    const stroke: Stroke = {
      color: patch.color ?? a.stroke.color,
      width: patch.strokeWidth !== undefined ? patch.strokeWidth * unit : a.stroke.width,
      style: patch.lineStyle ?? a.stroke.style,
    };
    if (a.kind === 'rect' || a.kind === 'ellipse')
      return { ...a, stroke, fill: patch.fill ?? a.fill };
    return { ...a, stroke };
  }
  if ((a.kind === 'text' || a.kind === 'number' || a.kind === 'magnify') && patch.color) {
    return { ...a, color: patch.color };
  }
  return a;
}
