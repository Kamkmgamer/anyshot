/**
 * Scroll-capture stitching. Frames are RGBA of the same size taken while the
 * user scrolls down. Each frame is compared with the previous one to find how
 * far the content moved; only the newly revealed rows are kept.
 *
 * Frames come from a video stream (YUV with subsampled colour), so rows are
 * compared by their luma profile with a small tolerance, not byte for byte.
 *
 * Screen captures draw the mouse pointer into every frame, and it sits over
 * the page while the user scrolls. Each frame can carry a mask around the
 * pointer: matching ignores it, and rows stitched with the pointer in them are
 * repainted from a later frame that shows the same content without it.
 */

export interface RgbaFrame {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/** A pixel area of a frame: rows [top, bottom), columns [left, right). */
export interface Area {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Pointer extent around its hot spot in CSS px: arrows reach right and down, hands and I-beams a little left and up. */
const POINTER = { left: 12, top: 12, right: 36, bottom: 44 };

/**
 * The frame area the pointer may cover, from its hot spot at the last samples
 * (it can move in between), in frame pixels. `scale` is frame pixels per CSS px.
 * Null when the pointer is outside the frame.
 */
export function pointerArea(
  spots: readonly { x: number; y: number }[],
  scale: number,
  width: number,
  height: number,
): Area | null {
  if (spots.length === 0) return null;
  const xs = spots.map((p) => p.x);
  const ys = spots.map((p) => p.y);
  const area = {
    top: Math.max(0, Math.min(...ys) - POINTER.top * scale),
    bottom: Math.min(height, Math.max(...ys) + POINTER.bottom * scale),
    left: Math.max(0, Math.min(...xs) - POINTER.left * scale),
    right: Math.min(width, Math.max(...xs) + POINTER.right * scale),
  };
  return area.top < area.bottom && area.left < area.right ? area : null;
}

/** A frame's area in profile terms: rows [top, bottom), buckets [first, last]. */
interface Mask {
  top: number;
  bottom: number;
  first: number;
  last: number;
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

function maskOf(area: Area | null | undefined, width: number, height: number): Mask | null {
  if (!area) return null;
  const top = Math.max(0, Math.floor(area.top));
  const bottom = Math.min(height, Math.ceil(area.bottom));
  const left = Math.max(0, Math.floor(area.left));
  const right = Math.min(width, Math.ceil(area.right));
  if (top >= bottom || left >= right) return null;
  const bucket = (x: number) => Math.min(BUCKETS - 1, Math.floor((x * BUCKETS) / width));
  return { top, bottom, first: bucket(left), last: bucket(right - 1) };
}

function covers(m: Mask | null, row: number, k: number): boolean {
  return m !== null && row >= m.top && row < m.bottom && k >= m.first && k <= m.last;
}

/** Profiles of a frame, with its pointer mask. */
export interface Profile {
  rows: Uint8Array;
  mask: Mask | null;
}

export function profileOf(frame: RgbaFrame, pointer?: Area | null): Profile {
  return { rows: rowProfiles(frame), mask: maskOf(pointer, frame.width, frame.height) };
}

function rowsMatch(a: Profile, ai: number, b: Profile, bi: number): boolean {
  let total = 0;
  let compared = 0;
  for (let k = 0; k < BUCKETS; k++) {
    if (covers(a.mask, ai, k) || covers(b.mask, bi, k)) continue;
    const diff = Math.abs((a.rows[ai * BUCKETS + k] ?? 0) - (b.rows[bi * BUCKETS + k] ?? 0));
    if (diff > 12) return false;
    total += diff;
    compared++;
  }
  // A row hidden mostly by the pointer proves nothing either way.
  return compared >= BUCKETS / 2 && total / compared <= ROW_TOLERANCE;
}

/** Rows with visible structure; blank rows match anything and prove nothing. */
function distinctive(p: Profile, i: number): boolean {
  let min = 255;
  let max = 0;
  for (let k = 0; k < BUCKETS; k++) {
    if (covers(p.mask, i, k)) continue;
    const v = p.rows[i * BUCKETS + k] ?? 0;
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
function fixedRows(prev: Profile, next: Profile, height: number) {
  let top = 0;
  while (top < height && rowsMatch(prev, top, next, top)) top++;
  if (top === height) return { top: height, bottom: 0 };
  let bottom = 0;
  while (bottom < height - top && rowsMatch(prev, height - 1 - bottom, next, height - 1 - bottom))
    bottom++;
  return { top, bottom };
}

function verify(prev: Profile, next: Profile, start: number, end: number, d: number): number {
  let checked = 0;
  let matched = 0;
  for (let i = start; i < end - d; i++) {
    if (!distinctive(next, i)) continue;
    checked++;
    if (rowsMatch(next, i, prev, i + d)) matched++;
  }
  return checked >= 3 ? matched / checked : 0;
}

function search(prev: Profile, next: Profile, start: number, end: number): number | null {
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
export function findShift(prev: Profile, next: Profile, height: number): Shift | null {
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
  private out = new Uint8ClampedArray(0);
  private rows = 0;
  private last: { frame: RgbaFrame; profile: Profile } | null = null;
  /** Output row = frame row + offset, for the last frame's content rows. */
  private offset = 0;
  private footer = 0;
  /** Output areas stitched with the pointer in them, waiting for a clean copy. */
  private dirty: Area[] = [];

  constructor(
    readonly width: number,
    readonly frameHeight: number,
    private readonly maxHeight: number,
  ) {}

  get height(): number {
    return this.rows + this.footer;
  }

  /** Output areas that still show the pointer (for tests and diagnostics). */
  get pointerAreas(): readonly Area[] {
    return this.dirty;
  }

  /**
   * Adds a frame and returns its new rows, or null if the overlap is unknown.
   * `pointer` is where the mouse pointer was drawn into the frame, if known.
   */
  push(frame: RgbaFrame, pointer?: Area | null): number | null {
    if (frame.width !== this.width || frame.height !== this.frameHeight)
      throw new Error('Frame size changed');
    if (this.height >= this.maxHeight) return 0;
    const profile = profileOf(frame, pointer);
    if (!this.last) {
      const rows = Math.min(frame.height, this.maxHeight);
      this.append(frame, 0, rows);
      this.markDirty(pointer, 0, rows);
      this.last = { frame, profile };
      return rows;
    }
    const found = findShift(this.last.profile, profile, frame.height);
    if (!found) return null;
    let take = 0;
    if (found.shift > 0) {
      if (this.footer === 0 && found.fixedBottom > 0) {
        // The first frame's bottom rows were a sticky footer: hold them back until the end.
        this.trimRows(found.fixedBottom);
        this.footer = found.fixedBottom;
      }
      const end = frame.height - this.footer;
      this.offset = this.rows + found.shift - end;
      const room = this.maxHeight - this.height;
      take = Math.max(0, Math.min(found.shift, room));
      this.append(frame, end - found.shift, take);
      this.markDirty(pointer, end - found.shift, end - found.shift + take);
    }
    this.repair(frame, pointer, found.fixedTop, frame.height - this.footer);
    this.last = { frame, profile };
    return take;
  }

  private append(frame: RgbaFrame, from: number, count: number): void {
    if (count <= 0) return;
    const rowBytes = this.width * 4;
    const need = (this.rows + count) * rowBytes;
    if (need > this.out.length) {
      const grown = new Uint8ClampedArray(Math.max(need, this.out.length * 2));
      grown.set(this.out.subarray(0, this.rows * rowBytes));
      this.out = grown;
    }
    this.out.set(
      frame.data.subarray(from * rowBytes, (from + count) * rowBytes),
      this.rows * rowBytes,
    );
    this.rows += count;
  }

  /** Records the pointer's part of frame rows [from, to), just written to the output. */
  private markDirty(pointer: Area | null | undefined, from: number, to: number): void {
    if (!pointer) return;
    const top = Math.max(from, Math.floor(pointer.top));
    const bottom = Math.min(to, Math.ceil(pointer.bottom));
    const left = Math.max(0, Math.floor(pointer.left));
    const right = Math.min(this.width, Math.ceil(pointer.right));
    if (top >= bottom || left >= right) return;
    this.dirty.push({ top: top + this.offset, bottom: bottom + this.offset, left, right });
  }

  /** Repaints the dirty rows this frame shows away from its own pointer; the rest stay dirty. */
  private repair(
    frame: RgbaFrame,
    pointer: Area | null | undefined,
    contentTop: number,
    contentEnd: number,
  ): void {
    if (this.dirty.length === 0) return;
    const rowBytes = this.width * 4;
    const left: Area[] = [];
    for (const area of this.dirty) {
      const blocked =
        pointer && area.left < pointer.right && area.right > pointer.left ? pointer : null;
      let run: Area | null = null;
      for (let row = area.top; row < area.bottom; row++) {
        const y = row - this.offset;
        const visible =
          y >= contentTop && y < contentEnd && !(blocked && y >= blocked.top && y < blocked.bottom);
        if (visible) {
          const src = y * rowBytes;
          this.out.set(
            frame.data.subarray(src + area.left * 4, src + area.right * 4),
            row * rowBytes + area.left * 4,
          );
          run = null;
        } else if (run) {
          run.bottom = row + 1;
        } else {
          run = { ...area, top: row, bottom: row + 1 };
          left.push(run);
        }
      }
    }
    this.dirty = left;
  }

  private trimRows(n: number): void {
    this.rows = Math.max(0, this.rows - n);
    this.dirty = this.dirty
      .filter((a) => a.top < this.rows)
      .map((a) => ({ ...a, bottom: Math.min(a.bottom, this.rows) }));
  }

  /** The stitched image, with the sticky footer (if any) from the last frame. */
  result(): RgbaFrame {
    const rowBytes = this.width * 4;
    const out = new Uint8ClampedArray(this.height * rowBytes);
    out.set(this.out.subarray(0, this.rows * rowBytes));
    if (this.footer > 0 && this.last) {
      const { data, height } = this.last.frame;
      out.set(
        data.subarray((height - this.footer) * rowBytes, height * rowBytes),
        this.rows * rowBytes,
      );
    }
    return { data: out, width: this.width, height: this.height };
  }
}
