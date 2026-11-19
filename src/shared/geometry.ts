export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

/** Builds a normalised rectangle (non-negative size) from two corners. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function clampRect(r: Rect, bounds: Size): Rect {
  const x = Math.max(0, Math.min(r.x, bounds.width));
  const y = Math.max(0, Math.min(r.y, bounds.height));
  return {
    x,
    y,
    width: Math.max(0, Math.min(r.x + r.width, bounds.width) - x),
    height: Math.max(0, Math.min(r.y + r.height, bounds.height) - y),
  };
}

export function roundRect(r: Rect): Rect {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  return { x, y, width: Math.round(r.x + r.width) - x, height: Math.round(r.y + r.height) - y };
}

export function scaleRect(r: Rect, s: number): Rect {
  return { x: r.x * s, y: r.y * s, width: r.width * s, height: r.height * s };
}

export function pointInRect(p: Point, r: Rect, pad = 0): boolean {
  return (
    p.x >= r.x - pad &&
    p.x <= r.x + r.width + pad &&
    p.y >= r.y - pad &&
    p.y <= r.y + r.height + pad
  );
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Distance from p to the segment ab. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Snaps b around a to the nearest 45° direction (Shift-constrained lines). */
export function snap45(a: Point, b: Point): Point {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const step = Math.PI / 4;
  const snapped = Math.round(angle / step) * step;
  const len = distance(a, b);
  return { x: a.x + Math.cos(snapped) * len, y: a.y + Math.sin(snapped) * len };
}

/** Constrains the b corner so the rectangle from a is square. */
export function squareFrom(a: Point, b: Point): Point {
  const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  return { x: a.x + Math.sign(b.x - a.x || 1) * side, y: a.y + Math.sign(b.y - a.y || 1) * side };
}

/** H.264 needs even dimensions; round a region down to even numbers. */
export function evenRect(r: Rect): Rect {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  return {
    x,
    y,
    width: Math.max(2, Math.floor(r.width / 2) * 2),
    height: Math.max(2, Math.floor(r.height / 2) * 2),
  };
}
