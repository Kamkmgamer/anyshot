/**
 * Scroll-capture stitching. Frames are RGBA of the same size taken while the
 * user scrolls down. Each frame is compared with the previous one to find how
 * far the content moved; only the newly revealed rows are kept.
 *
 * Frames come from a video stream (YUV with subsampled colour), so rows are
 * compared by their luma profile with a small tolerance, not byte for byte.
 */

export interface RgbaFrame {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

const BUCKETS = 48;
const ROW_TOLERANCE = 2.5; // mean absolute luma difference per bucket
const MIN_OVERLAP = 24;
const MIN_MATCH = 0.95;

/** Per-row luma averaged into column buckets: height × BUCKETS bytes. */
export function rowProfiles(frame: RgbaFrame): Uint8Array {
  const { data, width, height } = frame;
  const out = new Uint8Array(height * BUCKETS);
  const sums = new Float64Array(BUCKETS);
  const counts = new Uint32Array(BUCKETS);
  for (let y = 0; y < height; y++) {
    sums.fill(0);
    counts.fill(0);
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      const b = Math.min(BUCKETS - 1, Math.floor((x * BUCKETS) / width));
      sums[b] =
        (sums[b] ?? 0) +
        0.299 * (data[i] ?? 0) +
        0.587 * (data[i + 1] ?? 0) +
        0.114 * (data[i + 2] ?? 0);
      counts[b] = (counts[b] ?? 0) + 1;
    }
    for (let b = 0; b < BUCKETS; b++)
      out[y * BUCKETS + b] = Math.round((sums[b] ?? 0) / Math.max(1, counts[b] ?? 1));
  }
  return out;
}

function rowsMatch(a: Uint8Array, ai: number, b: Uint8Array, bi: number): boolean {
  let total = 0;
  for (let k = 0; k < BUCKETS; k++) {
    const diff = Math.abs((a[ai * BUCKETS + k] ?? 0) - (b[bi * BUCKETS + k] ?? 0));
    if (diff > 12) return false;
    total += diff;
  }
  return total / BUCKETS <= ROW_TOLERANCE;
}

/** Rows with visible structure; blank rows match anything and prove nothing. */
function distinctive(p: Uint8Array, i: number): boolean {
  let min = 255;
  let max = 0;
  for (let k = 0; k < BUCKETS; k++) {
    const v = p[i * BUCKETS + k] ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min > 8;
}

export interface Shift {
  /** Rows the content moved up by. 0 means unchanged. */
  shift: number;
  fixedTop: number;
  fixedBottom: number;
}

/** Rows at the top/bottom that stayed put (sticky headers, footers). */
function fixedRows(prev: Uint8Array, next: Uint8Array, height: number) {
  let top = 0;
  while (top < height && rowsMatch(prev, top, next, top)) top++;
  if (top === height) return { top: height, bottom: 0 };
  let bottom = 0;
  while (bottom < height - top && rowsMatch(prev, height - 1 - bottom, next, height - 1 - bottom))
    bottom++;
  return { top, bottom };
}

function verify(prev: Uint8Array, next: Uint8Array, start: number, end: number, d: number): number {
  let checked = 0;
  let matched = 0;
  for (let i = start; i < end - d; i++) {
    if (!distinctive(next, i)) continue;
    checked++;
    if (rowsMatch(next, i, prev, i + d)) matched++;
  }
  return checked >= 3 ? matched / checked : 0;
}

function search(prev: Uint8Array, next: Uint8Array, start: number, end: number): number | null {
  const band = end - start;
  if (band < MIN_OVERLAP * 2) return null;
  // Anchor on the first few distinctive rows near the top of the band: they are still
  // visible in the previous frame for any plausible shift.
  const anchors: number[] = [];
  for (let i = start; i < end - MIN_OVERLAP && anchors.length < 3; i++)
    if (distinctive(next, i)) anchors.push(i);
  const first = anchors[0];
  if (first === undefined) return null;
  let best: { d: number; score: number } | null = null;
  for (let d = 1; first + d < end && band - d >= MIN_OVERLAP; d++) {
    if (!anchors.every((a) => a + d >= end || rowsMatch(next, a, prev, a + d))) continue;
    const score = verify(prev, next, start, end, d);
    if (score >= MIN_MATCH && (!best || score > best.score)) best = { d, score };
  }
  return best?.d ?? null;
}

/** Finds how far the content scrolled between two frames, or null if it can't tell. */
export function findShift(prev: Uint8Array, next: Uint8Array, height: number): Shift | null {
  const fixed = fixedRows(prev, next, height);
  if (fixed.top === height) return { shift: 0, fixedTop: 0, fixedBottom: 0 };
  const shift = search(prev, next, fixed.top, height - fixed.bottom);
  if (shift !== null) return { shift, fixedTop: fixed.top, fixedBottom: fixed.bottom };
  // A "fixed" band may just be a coincidence; retry over the whole frame.
  const loose = search(prev, next, 0, height);
  return loose === null ? null : { shift: loose, fixedTop: 0, fixedBottom: 0 };
}

/** Accumulates scrolled frames into one tall image, keeping only new rows. */
export class Stitcher {
  private chunks: Uint8Array[] = [];
  private rows = 0;
  private last: { frame: RgbaFrame; profile: Uint8Array } | null = null;
  private footer = 0;

  constructor(
    readonly width: number,
    readonly frameHeight: number,
    private readonly maxHeight: number,
  ) {}

  get height(): number {
    return this.rows + this.footer;
  }

  /** Adds a frame; returns how many rows it contributed (0 when nothing new or unknown). */
  push(frame: RgbaFrame): number {
    if (frame.width !== this.width || frame.height !== this.frameHeight)
      throw new Error('Frame size changed');
    const profile = rowProfiles(frame);
    const rowBytes = this.width * 4;
    if (!this.last) {
      this.chunks.push(frame.data.slice(0) as Uint8Array);
      this.rows = frame.height;
      this.last = { frame, profile };
      return frame.height;
    }
    const found = findShift(this.last.profile, profile, frame.height);
    if (!found || found.shift === 0) return 0;
    if (this.footer === 0 && found.fixedBottom > 0) {
      // The first frame's bottom rows were a sticky footer: hold them back until the end.
      this.trimRows(found.fixedBottom);
      this.footer = found.fixedBottom;
    }
    const end = frame.height - this.footer;
    const room = this.maxHeight - this.height;
    const take = Math.max(0, Math.min(found.shift, room));
    if (take > 0) {
      this.chunks.push(
        frame.data.slice(
          (end - found.shift) * rowBytes,
          (end - found.shift + take) * rowBytes,
        ) as Uint8Array,
      );
      this.rows += take;
    }
    this.last = { frame, profile };
    return take;
  }

  private trimRows(n: number): void {
    const rowBytes = this.width * 4;
    let remove = n;
    while (remove > 0 && this.chunks.length > 0) {
      const lastChunk = this.chunks[this.chunks.length - 1] as Uint8Array;
      const chunkRows = lastChunk.length / rowBytes;
      if (chunkRows <= remove) {
        this.chunks.pop();
        remove -= chunkRows;
      } else {
        this.chunks[this.chunks.length - 1] = lastChunk.slice(0, (chunkRows - remove) * rowBytes);
        remove = 0;
      }
    }
    this.rows -= n;
  }

  /** The stitched image, with the sticky footer (if any) from the last frame. */
  result(): RgbaFrame {
    const rowBytes = this.width * 4;
    const out = new Uint8ClampedArray(this.height * rowBytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    if (this.footer > 0 && this.last) {
      const { data, height } = this.last.frame;
      out.set(data.subarray((height - this.footer) * rowBytes, height * rowBytes), offset);
    }
    return { data: out, width: this.width, height: this.height };
  }
}
