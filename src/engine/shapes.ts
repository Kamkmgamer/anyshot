import {
  distance,
  distanceToSegment,
  type Point,
  pointInRect,
  type Rect,
  rectFromPoints,
} from '../shared/geometry';
import type { Annotation, TextAnnotation } from './model';

/** Measures a line of text in CSS-font terms; injected so tests can run without a canvas. */
export type TextMeasurer = (text: string, font: string) => number;

/** Estimate from the font's pixel size, used only where no canvas is available. */
export const estimateTextWidth: TextMeasurer = (text, font) => {
  const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '') || 16;
  return text.length * size * 0.58;
};

let measurer: TextMeasurer = estimateTextWidth;

export function setTextMeasurer(m: TextMeasurer): void {
  measurer = m;
}

/** Real text metrics from a 2D context. */
export function canvasTextMeasurer(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
): TextMeasurer {
  return (text, font) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}

export const TEXT_LINE_HEIGHT = 1.25;
export const textFont = (size: number) =>
  `600 ${size}px "Segoe UI", system-ui, -apple-system, "Noto Sans", sans-serif`;
export const textPadding = (size: number) => Math.round(size * 0.3);

/** The box a text annotation occupies, including its background padding. */
export function textBox(t: TextAnnotation): Rect {
  const lines = t.text.split('\n');
  const font = textFont(t.size);
  const width = Math.max(t.size * 0.5, ...lines.map((line) => measurer(line, font)));
  const pad = textPadding(t.size);
  return {
    x: t.at.x - pad,
    y: t.at.y - pad,
    width: width + pad * 2,
    height: lines.length * t.size * TEXT_LINE_HEIGHT + pad * 2,
  };
}

/** Axis-aligned bounds of an annotation in image pixels (stroke excluded). */
export function bounds(a: Annotation): Rect {
  switch (a.kind) {
    case 'pencil':
    case 'marker': {
      const xs = a.points.map((p) => p.x);
      const ys = a.points.map((p) => p.y);
      return rectFromPoints(
        { x: Math.min(...xs), y: Math.min(...ys) },
        { x: Math.max(...xs), y: Math.max(...ys) },
      );
    }
    case 'line':
    case 'arrow':
    case 'measure':
      return rectFromPoints(a.a, a.b);
    case 'rect':
    case 'ellipse':
    case 'censor':
    case 'spotlight':
      return a.rect;
    case 'text':
      return textBox(a);
    case 'number':
      return { x: a.at.x - a.size / 2, y: a.at.y - a.size / 2, width: a.size, height: a.size };
    case 'magnify':
      return {
        x: a.at.x - a.radius,
        y: a.at.y - a.radius,
        width: a.radius * 2,
        height: a.radius * 2,
      };
    case 'stamp':
      return { x: a.at.x - a.size / 2, y: a.at.y - a.size / 2, width: a.size, height: a.size };
  }
}

/** Whether point p (image px) hits the annotation, with a tolerance in image px. */
export function hitTest(a: Annotation, p: Point, tolerance: number): boolean {
  switch (a.kind) {
    case 'pencil':
    case 'marker': {
      const reach =
        tolerance + (a.kind === 'marker' ? markerWidth(a.stroke.width) : a.stroke.width) / 2;
      if (a.points.length === 1) return distance(p, a.points[0] as Point) <= reach;
      for (let i = 1; i < a.points.length; i++) {
        if (distanceToSegment(p, a.points[i - 1] as Point, a.points[i] as Point) <= reach)
          return true;
      }
      return false;
    }
    case 'line':
    case 'arrow':
    case 'measure':
      return distanceToSegment(p, a.a, a.b) <= tolerance + a.stroke.width / 2;
    case 'rect': {
      if (a.fill !== 'stroke') return pointInRect(p, a.rect, tolerance);
      const edge = tolerance + a.stroke.width / 2;
      return pointInRect(p, a.rect, edge) && !pointInRect(p, inset(a.rect, edge), 0);
    }
    case 'ellipse': {
      const { x, y, width, height } = a.rect;
      const rx = width / 2;
      const ry = height / 2;
      if (rx < 1 || ry < 1) return pointInRect(p, a.rect, tolerance);
      const nx = (p.x - (x + rx)) / rx;
      const ny = (p.y - (y + ry)) / ry;
      const r = Math.hypot(nx, ny);
      if (a.fill !== 'stroke') return r <= 1 + tolerance / Math.min(rx, ry);
      const band = (tolerance + a.stroke.width / 2) / Math.min(rx, ry);
      return Math.abs(r - 1) <= band;
    }
    case 'censor':
    case 'spotlight':
    case 'text':
      return pointInRect(p, bounds(a), tolerance);
    case 'number':
    case 'stamp':
      return distance(p, a.at) <= a.size / 2 + tolerance;
    case 'magnify':
      return distance(p, a.at) <= a.radius + tolerance;
  }
}

export function markerWidth(width: number): number {
  return Math.max(12, width * 4);
}

function inset(r: Rect, d: number): Rect {
  return { x: r.x + d, y: r.y + d, width: r.width - 2 * d, height: r.height - 2 * d };
}

/** Topmost annotation under p, scanning from the last drawn. */
export function topmostAt(annotations: readonly Annotation[], p: Point, tolerance: number) {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i] as Annotation;
    if (hitTest(a, p, tolerance)) return a;
  }
  return undefined;
}

export function translate<A extends Annotation>(a: A, dx: number, dy: number): A {
  const move = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  const moveRect = (r: Rect): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });
  switch (a.kind) {
    case 'pencil':
    case 'marker':
      return { ...a, points: a.points.map(move) };
    case 'line':
    case 'arrow':
    case 'measure':
      return { ...a, a: move(a.a), b: move(a.b) };
    case 'rect':
    case 'ellipse':
    case 'censor':
    case 'spotlight':
      return { ...a, rect: moveRect(a.rect) };
    case 'text':
    case 'number':
    case 'magnify':
    case 'stamp':
      return { ...a, at: move(a.at) };
  }
}

export type HandleId = 'a' | 'b' | 'nw' | 'ne' | 'sw' | 'se' | 'radius';

export interface Handle {
  id: HandleId;
  at: Point;
}

/** Drag handles for editing an annotation's geometry. */
export function handles(a: Annotation): Handle[] {
  switch (a.kind) {
    case 'line':
    case 'arrow':
    case 'measure':
      return [
        { id: 'a', at: a.a },
        { id: 'b', at: a.b },
      ];
    case 'rect':
    case 'ellipse':
    case 'censor':
    case 'spotlight': {
      const { x, y, width, height } = a.rect;
      return [
        { id: 'nw', at: { x, y } },
        { id: 'ne', at: { x: x + width, y } },
        { id: 'sw', at: { x, y: y + height } },
        { id: 'se', at: { x: x + width, y: y + height } },
      ];
    }
    case 'magnify':
      return [{ id: 'radius', at: { x: a.at.x + a.radius, y: a.at.y } }];
    default:
      return [];
  }
}

/** Applies a handle drag to p; returns the edited annotation. */
export function dragHandle<A extends Annotation>(a: A, id: HandleId, p: Point): A {
  switch (a.kind) {
    case 'line':
    case 'arrow':
    case 'measure':
      return id === 'a' ? { ...a, a: p } : id === 'b' ? { ...a, b: p } : a;
    case 'rect':
    case 'ellipse':
    case 'censor':
    case 'spotlight': {
      const { x, y, width, height } = a.rect;
      const opposite: Record<string, Point> = {
        nw: { x: x + width, y: y + height },
        ne: { x, y: y + height },
        sw: { x: x + width, y },
        se: { x, y },
      };
      const anchor = opposite[id];
      return anchor ? { ...a, rect: rectFromPoints(anchor, p) } : a;
    }
    case 'magnify':
      return id === 'radius' ? { ...a, radius: Math.max(12, distance(a.at, p)) } : a;
    default:
      return a;
  }
}
