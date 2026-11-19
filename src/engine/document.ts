import { type Point, type Rect, rectFromPoints } from '../shared/geometry';
import { apply, type Change, History } from './history';
import {
  type Annotation,
  type CensorMode,
  DEFAULT_EFFECTS,
  type Doc,
  type Effects,
  emptyDoc,
  type FillMode,
  type LineStyle,
  type Stroke,
} from './model';
import { translate } from './shapes';

type Listener = (doc: Doc) => void;

/** Holds the document, its undo history and the annotation selection. */
export class DocStore {
  private current: Doc;
  private readonly history = new History();
  private readonly listeners = new Set<Listener>();
  private selection = new Set<string>();

  constructor(doc: Doc = emptyDoc()) {
    this.current = doc;
  }

  get doc(): Doc {
    return this.current;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  get selected(): ReadonlySet<string> {
    return this.selection;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  commit(change: Change): void {
    this.current = apply(this.current, change);
    this.history.push(change);
    this.pruneSelection();
    this.emit();
  }

  undo(): boolean {
    const change = this.history.undo();
    if (!change) return false;
    this.current = apply(this.current, change);
    this.pruneSelection();
    this.emit();
    return true;
  }

  redo(): boolean {
    const change = this.history.redo();
    if (!change) return false;
    this.current = apply(this.current, change);
    this.pruneSelection();
    this.emit();
    return true;
  }

  /** Replaces the document wholesale (e.g. opening a project); clears history. */
  reset(doc: Doc): void {
    this.current = doc;
    this.history.clear();
    this.selection = new Set();
    this.emit();
  }

  add(annotation: Annotation): void {
    this.commit({ type: 'add', annotation, index: this.current.annotations.length });
  }

  update(before: Annotation, after: Annotation): void {
    if (before === after) return;
    this.commit({ type: 'update', before, after });
  }

  /** Applies one function to every selected annotation as a single undo step. */
  updateSelected(fn: (a: Annotation) => Annotation): void {
    const changes: Change[] = [];
    for (const a of this.current.annotations) {
      if (!this.selection.has(a.id)) continue;
      const after = fn(a);
      if (after !== a) changes.push({ type: 'update', before: a, after });
    }
    if (changes.length > 0) this.commit({ type: 'batch', changes });
  }

  removeSelected(): void {
    const changes: Change[] = this.current.annotations
      .map((annotation, index) => ({ annotation, index }))
      .filter(({ annotation }) => this.selection.has(annotation.id))
      .reverse()
      .map(({ annotation, index }) => ({ type: 'remove', annotation, index }));
    if (changes.length > 0) this.commit({ type: 'batch', changes });
  }

  /** Duplicates the selection, offset slightly, and selects the copies. */
  duplicateSelected(offset: number, makeId: () => string): void {
    const copies = this.current.annotations
      .filter((a) => this.selection.has(a.id))
      .map((a) => ({ ...translate(a, offset, offset), id: makeId() }));
    if (copies.length === 0) return;
    const start = this.current.annotations.length;
    this.commit({
      type: 'batch',
      changes: copies.map((annotation, i) => ({ type: 'add', annotation, index: start + i })),
    });
    this.select(copies.map((a) => a.id));
  }

  setEffects(after: Effects): void {
    this.commit({ type: 'effects', before: this.current.effects, after });
  }

  setCrop(after: Rect | null): void {
    this.commit({ type: 'crop', before: this.current.crop, after });
  }

  select(ids: Iterable<string>): void {
    this.selection = new Set(ids);
    this.emit();
  }

  find(id: string): Annotation | undefined {
    return this.current.annotations.find((a) => a.id === id);
  }

  private pruneSelection(): void {
    const ids = new Set(this.current.annotations.map((a) => a.id));
    for (const id of this.selection) if (!ids.has(id)) this.selection.delete(id);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.current);
  }
}

// ---------------------------------------------------------------------------
// Serialisation. Documents travel between windows and live in project files,
// so parsing validates every field and drops anything malformed.

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
/** Sizes that become canvas radii or font sizes, which must be positive. */
const isSize = (v: unknown): v is number => isNum(v) && v > 0;
const COLOR = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

function point(v: unknown): Point | null {
  return isObj(v) && isNum(v.x) && isNum(v.y) ? { x: v.x, y: v.y } : null;
}

function rect(v: unknown): Rect | null {
  return isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.width) && isNum(v.height)
    ? { x: v.x, y: v.y, width: v.width, height: v.height }
    : null;
}

/** An annotation's rect with non-negative size, so canvas paths built from it can't throw. */
function box(v: unknown): Rect | null {
  const r = rect(v);
  return r && rectFromPoints(r, { x: r.x + r.width, y: r.y + r.height });
}

function color(v: unknown): string | null {
  return isStr(v) && COLOR.test(v) ? v : null;
}

function stroke(v: unknown): Stroke | null {
  if (!isObj(v)) return null;
  const c = color(v.color);
  const style = (['solid', 'dashed', 'dotted'] as LineStyle[]).find((s) => s === v.style);
  return c && isNum(v.width) && v.width > 0 && style ? { color: c, width: v.width, style } : null;
}

export function parseAnnotation(v: unknown): Annotation | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.kind)) return null;
  const id = v.id;
  switch (v.kind) {
    case 'pencil':
    case 'marker': {
      const s = stroke(v.stroke);
      const points = Array.isArray(v.points) ? v.points.map(point) : [];
      if (!s || points.length === 0 || points.some((p) => !p)) return null;
      return { id, kind: v.kind, stroke: s, points: points as Point[] };
    }
    case 'line':
    case 'arrow':
    case 'measure': {
      const a = point(v.a);
      const b = point(v.b);
      const s = stroke(v.stroke);
      return a && b && s ? { id, kind: v.kind, a, b, stroke: s } : null;
    }
    case 'rect':
    case 'ellipse': {
      const r = box(v.rect);
      const s = stroke(v.stroke);
      const fill = (['stroke', 'fill', 'both'] as FillMode[]).find((f) => f === v.fill);
      if (!r || !s || !fill) return null;
      const radius = isNum(v.radius) ? Math.max(0, v.radius) : 0;
      return { id, kind: v.kind, rect: r, stroke: s, fill, radius };
    }
    case 'text': {
      const at = point(v.at);
      const c = color(v.color);
      if (!at || !c || !isStr(v.text) || !isSize(v.size)) return null;
      return {
        id,
        kind: 'text',
        at,
        text: v.text,
        size: v.size,
        color: c,
        background: v.background === true,
      };
    }
    case 'number': {
      const at = point(v.at);
      const c = color(v.color);
      if (!at || !c || !isNum(v.value) || !isSize(v.size)) return null;
      return { id, kind: 'number', at, value: v.value, size: v.size, color: c };
    }
    case 'censor': {
      const r = box(v.rect);
      const mode = (['pixelate', 'blur', 'solid'] as CensorMode[]).find((m) => m === v.mode);
      return r && mode ? { id, kind: 'censor', rect: r, mode } : null;
    }
    case 'spotlight': {
      const r = box(v.rect);
      return r && isNum(v.dim) ? { id, kind: 'spotlight', rect: r, dim: v.dim } : null;
    }
    case 'magnify': {
      const at = point(v.at);
      const c = color(v.color);
      if (!at || !c || !isSize(v.radius) || !isSize(v.zoom)) return null;
      return { id, kind: 'magnify', at, radius: v.radius, zoom: v.zoom, color: c };
    }
    case 'stamp': {
      const at = point(v.at);
      if (!at || !isStr(v.emoji) || !isSize(v.size)) return null;
      return { id, kind: 'stamp', at, emoji: v.emoji, size: v.size };
    }
    default:
      return null;
  }
}

function parseEffects(v: unknown): Effects {
  if (!isObj(v)) return DEFAULT_EFFECTS;
  const d = DEFAULT_EFFECTS;
  const adj = isObj(v.adjust) ? v.adjust : {};
  const beau = isObj(v.beautify) ? v.beautify : {};
  const n = (x: unknown, fallback: number, min: number, max: number) =>
    isNum(x) ? Math.min(max, Math.max(min, x)) : fallback;
  return {
    invert: v.invert === true,
    adjust: {
      brightness: n(adj.brightness, d.adjust.brightness, -0.5, 0.5),
      contrast: n(adj.contrast, d.adjust.contrast, 0.5, 2),
      saturation: n(adj.saturation, d.adjust.saturation, 0, 2),
      sharpness: n(adj.sharpness, d.adjust.sharpness, 0, 2),
    },
    beautify: {
      enabled: beau.enabled === true,
      padding: n(beau.padding, d.beautify.padding, 0, 200),
      radius: n(beau.radius, d.beautify.radius, 0, 60),
      shadow: n(beau.shadow, d.beautify.shadow, 0, 100),
      background: Math.round(n(beau.background, d.beautify.background, 0, 99)),
    },
  };
}

export function parseDoc(v: unknown): Doc {
  if (!isObj(v)) return emptyDoc();
  const annotations = Array.isArray(v.annotations)
    ? v.annotations.map(parseAnnotation).filter((a): a is Annotation => a !== null)
    : [];
  return {
    version: 1,
    unit: isNum(v.unit) && v.unit > 0 ? v.unit : 1,
    annotations,
    effects: parseEffects(v.effects),
    crop: rect(v.crop),
  };
}

/** Moves every annotation by (dx, dy): used when a region becomes its own image. */
export function translateDoc(doc: Doc, dx: number, dy: number): Doc {
  return { ...doc, annotations: doc.annotations.map((a) => translate(a, dx, dy)) };
}
