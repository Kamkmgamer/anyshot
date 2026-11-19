/** Geometry of a node-screenshots monitor (physical pixels). */
export interface MonitorInfo {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The parts of an Electron Display used for matching. */
export interface DisplayInfo {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  nativeOrigin?: { x: number; y: number };
}

/**
 * Finds the monitor that corresponds to an Electron display. Ids match on X11;
 * on Windows they don't, so fall back to the closest physical geometry.
 */
export function matchMonitor<M extends MonitorInfo>(
  monitors: M[],
  display: DisplayInfo,
): M | undefined {
  const byId = monitors.find((m) => m.id === display.id);
  if (byId) return byId;
  const s = display.scaleFactor;
  const origin = display.nativeOrigin ?? { x: display.bounds.x * s, y: display.bounds.y * s };
  const w = Math.round(display.bounds.width * s);
  const h = Math.round(display.bounds.height * s);
  let best: M | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const m of monitors) {
    const score =
      Math.min(
        Math.abs(m.x - origin.x) + Math.abs(m.y - origin.y),
        Math.abs(m.x - display.bounds.x) + Math.abs(m.y - display.bounds.y),
      ) +
      Math.abs(m.width - w) +
      Math.abs(m.height - h);
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

/** Converts BGRA (Chromium's native bitmap order) to RGBA in place. */
export function bgraToRgba(pixels: Uint8Array): Uint8Array {
  const words = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength >>> 2);
  for (let i = 0; i < words.length; i++) {
    const v = words[i] as number;
    words[i] = (v & 0xff00ff00) | ((v & 0xff) << 16) | ((v >>> 16) & 0xff);
  }
  return pixels;
}
