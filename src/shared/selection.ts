import type { Point, Rect, Size } from './geometry';

export type SelectionHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
export const SELECTION_HANDLES: SelectionHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Resizes a selection by dragging one handle to p, clamped to the display. */
export function resizeSelection(r: Rect, handle: SelectionHandle, p: Point, bounds: Size): Rect {
  let left = r.x;
  let top = r.y;
  let right = r.x + r.width;
  let bottom = r.y + r.height;
  const x = Math.max(0, Math.min(bounds.width, p.x));
  const y = Math.max(0, Math.min(bounds.height, p.y));
  if (handle.includes('w')) left = x;
  if (handle.includes('e')) right = x;
  if (handle.includes('n')) top = y;
  if (handle.includes('s')) bottom = y;
  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top),
  };
}

/** Which handle a resize ends up on after flipping past the opposite edge. */
export function flippedHandle(r: Rect, handle: SelectionHandle, p: Point): SelectionHandle {
  let h: string = handle;
  if (h.includes('w') && p.x > r.x + r.width) h = h.replace('w', 'e');
  else if (h.includes('e') && p.x < r.x) h = h.replace('e', 'w');
  if (h.includes('n') && p.y > r.y + r.height) h = h.replace('n', 's');
  else if (h.includes('s') && p.y < r.y) h = h.replace('s', 'n');
  return h as SelectionHandle;
}

/** Moves a selection, keeping it entirely on the display. */
export function moveSelection(r: Rect, dx: number, dy: number, bounds: Size): Rect {
  return {
    ...r,
    x: Math.max(0, Math.min(bounds.width - r.width, r.x + dx)),
    y: Math.max(0, Math.min(bounds.height - r.height, r.y + dy)),
  };
}

/** Converts a CSS-pixel selection to whole image pixels inside the frame. */
export function toImageRegion(r: Rect, scale: number, frame: Size): Rect {
  const x = Math.max(0, Math.min(frame.width - 1, Math.round(r.x * scale)));
  const y = Math.max(0, Math.min(frame.height - 1, Math.round(r.y * scale)));
  const right = Math.max(x + 1, Math.min(frame.width, Math.round((r.x + r.width) * scale)));
  const bottom = Math.max(y + 1, Math.min(frame.height, Math.round((r.y + r.height) * scale)));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Places a toolbar of size `bar` next to `sel` inside `screen`: preferred side
 * first, then the opposite side, then inside the selection.
 */
/**
 * Where a popover opens from a floating toolbar: below it unless that runs off
 * the screen and there is room above. `bar` is the toolbar's vertical extent.
 */
export function popoverSide(
  bar: { top: number; bottom: number },
  popoverHeight: number,
  screenHeight: number,
  gap = 8,
): 'below' | 'above' {
  if (bar.bottom + popoverHeight + gap <= screenHeight) return 'below';
  return bar.top - popoverHeight - gap >= 0 ? 'above' : 'below';
}

export function placeToolbar(
  sel: Rect,
  bar: Size,
  screen: Size,
  side: 'below' | 'right',
  gap = 8,
): Point {
  const clampX = (x: number) => Math.max(gap, Math.min(screen.width - bar.width - gap, x));
  const clampY = (y: number) => Math.max(gap, Math.min(screen.height - bar.height - gap, y));
  if (side === 'below') {
    const x = clampX(sel.x + sel.width / 2 - bar.width / 2);
    if (sel.y + sel.height + gap + bar.height + gap <= screen.height)
      return { x, y: sel.y + sel.height + gap };
    if (sel.y - gap - bar.height >= gap) return { x, y: sel.y - gap - bar.height };
    return { x, y: clampY(sel.y + sel.height - bar.height - gap) };
  }
  const y = clampY(sel.y);
  if (sel.x + sel.width + gap + bar.width + gap <= screen.width)
    return { x: sel.x + sel.width + gap, y };
  if (sel.x - gap - bar.width >= gap) return { x: sel.x - gap - bar.width, y };
  return { x: clampX(sel.x + sel.width - bar.width - gap), y };
}
