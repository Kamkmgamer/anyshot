/**
 * Scroll-capture stitching. Frames are RGBA of the same size taken while the
 * user scrolls. Each frame is compared with the last placed one to find how
 * far the content moved (either way); rows past the end of the stitch so far
 * are appended.
 *
 * Frames come from a video stream (YUV with subsampled colour), so rows are
 * compared by their luma profile with a small tolerance, not byte for byte.
 * Smooth scrolling and display scaling also paint content at sub-pixel
 * offsets, which redraws anti-aliased edges slightly differently from frame to
 * frame: a match needs most rows, not all, to agree.
 *
 * Screen captures draw the mouse pointer into every frame, and it sits over
 * the page while the user scrolls. Each frame can carry masks around the
 * pointer: matching ignores them, and rows stitched with the pointer in them
 * are repainted from a later frame that shows the same content without it.
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
 * The frame areas the pointer may cover, one around each recent hot spot (it
 * can move between samples), in frame pixels. `scale` is frame pixels per CSS
 * px. Spots whose area falls outside the frame are left out.
 */
export function pointerAreas(
  spots: readonly { x: number; y: number }[],
  scale: number,
  width: number,
  height: number,
): Area[] {
  const areas: Area[] = [];
  for (const { x, y } of spots) {
    const area = {
      top: Math.max(0, y - POINTER.top * scale),
      bottom: Math.min(height, y + POINTER.bottom * scale),
      left: Math.max(0, x - POINTER.left * scale),
      right: Math.min(width, x + POINTER.right * scale),
    };
    if (area.top < area.bottom && area.left < area.right) areas.push(area);
  }
  return areas;
}

const BUCKETS = 48;
const ROW_TOLERANCE = 2.5; // mean absolute luma difference per bucket
const BUCKET_TOLERANCE = 12; // any one bucket further off than this is a different row
const MIN_OVERLAP = 24;
/** Share of comparable rows that must agree: sub-pixel offsets redraw some edges differently. */
const MIN_MATCH = 0.85;
/** Fewest comparable rows a shift must be checked on. */
const MIN_CHECKED = 4;
/** Rows sampled to rank candidate shifts before checking the best ones in full. */
const SAMPLES = 64;
const FINALISTS = 4;

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

/** Profiles of a frame, with the buckets its pointer hides (1 = hidden), if any. */
export interface Profile {
  rows: Uint8Array;
  hidden: Uint8Array | null;
}

function hiddenBuckets(areas: readonly Area[], width: number, height: number): Uint8Array | null {
  let hidden: Uint8Array | null = null;
  const bucket = (x: number) => Math.min(BUCKETS - 1, Math.floor((x * BUCKETS) / width));
  for (const area of areas) {
    const top = Math.max(0, Math.floor(area.top));
    const bottom = Math.min(height, Math.ceil(area.bottom));
    const left = Math.max(0, Math.floor(area.left));
    const right = Math.min(width, Math.ceil(area.right));
    if (top >= bottom || left >= right) continue;
    hidden ??= new Uint8Array(height * BUCKETS);
    for (let y = top; y < bottom; y++)
      hidden.fill(1, y * BUCKETS + bucket(left), y * BUCKETS + bucket(right - 1) + 1);
  }
  return hidden;
}

export function profileOf(frame: RgbaFrame, pointer: readonly Area[] = []): Profile {
  return {
    rows: rowProfiles(frame),
    hidden: hiddenBuckets(pointer, frame.width, frame.height),
  };
}

const isHidden = (p: Profile, i: number) => p.hidden !== null && p.hidden[i] === 1;

/**
 * Mean luma difference of two rows over the buckets neither pointer hides, and
 * the largest single difference. Null when the pointer hides too much of either
 * row to tell anything.
 */
function compareRows(
  a: Profile,
  ai: number,
  b: Profile,
  bi: number,
): { mean: number; worst: number } | null {
  let total = 0;
  let worst = 0;
  let compared = 0;
  const ra = ai * BUCKETS;
  const rb = bi * BUCKETS;
  for (let k = 0; k < BUCKETS; k++) {
    if (isHidden(a, ra + k) || isHidden(b, rb + k)) continue;
    const diff = Math.abs((a.rows[ra + k] ?? 0) - (b.rows[rb + k] ?? 0));
    total += diff;
    if (diff > worst) worst = diff;
    compared++;
  }
  return compared >= BUCKETS / 2 ? { mean: total / compared, worst } : null;
}

/** Whether two rows show the same content; null when the pointer hides too much to tell. */
function rowsMatch(a: Profile, ai: number, b: Profile, bi: number): boolean | null {
  const c = compareRows(a, ai, b, bi);
  return c && c.worst <= BUCKET_TOLERANCE && c.mean <= ROW_TOLERANCE;
}

/** Rows with visible structure outside the pointer; blank rows match anything and prove nothing. */
function distinctive(p: Profile, i: number): boolean {
  let min = 255;
  let max = 0;
  let seen = 0;
  for (let k = 0; k < BUCKETS; k++) {
    if (isHidden(p, i * BUCKETS + k)) continue;
    const v = p.rows[i * BUCKETS + k] ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
    seen++;
  }
  return seen >= BUCKETS / 2 && max - min > 8;
}

export interface Shift {
  /** Rows the content moved up by (negative: down, after scrolling back up). 0 means unchanged. */
  shift: number;
  fixedTop: number;
  fixedBottom: number;
}

/** Rows at the top/bottom that stayed put (sticky headers, footers). */
function fixedRows(prev: Profile, next: Profile, height: number) {
  let top = 0;
  while (top < height && rowsMatch(prev, top, next, top) === true) top++;
  if (top === height) return { top: height, bottom: 0 };
  let bottom = 0;
  while (
    bottom < height - top &&
    rowsMatch(prev, height - 1 - bottom, next, height - 1 - bottom) === true
  )
    bottom++;
  return { top, bottom };
}

/** How well `next` row i matches `prev` row i + d across the band [start, end). */
function score(prev: Profile, next: Profile, start: number, end: number, d: number) {
  let checked = 0;
  let matched = 0;
  let total = 0;
  for (let i = Math.max(start, start - d); i < Math.min(end, end - d); i++) {
    if (!distinctive(next, i)) continue;
    const c = compareRows(next, i, prev, i + d);
    if (!c) continue;
    checked++;
    total += c.mean;
    if (c.worst <= BUCKET_TOLERANCE && c.mean <= ROW_TOLERANCE) matched++;
  }
  return {
    checked,
    match: checked > 0 ? matched / checked : 0,
    mean: checked > 0 ? total / checked : Infinity,
  };
}

function search(prev: Profile, next: Profile, start: number, end: number): number | null {
  const band = end - start;
  if (band < MIN_OVERLAP * 2) return null;
  const rows: number[] = [];
  for (let i = start; i < end; i++) if (distinctive(next, i)) rows.push(i);
  if (rows.length < MIN_CHECKED) return null;
  // Rank every shift either way on a sample of rows, then check the best few on all rows.
  const step = Math.max(1, Math.floor(rows.length / SAMPLES));
  const sample = rows.filter((_, n) => n % step === 0);
  const limit = band - MIN_OVERLAP;
  const ranked: { d: number; mean: number }[] = [];
  for (let d = -limit; d <= limit; d++) {
    let total = 0;
    let n = 0;
    for (const i of sample) {
      const j = i + d;
      if (j < start || j >= end) continue;
      const c = compareRows(next, i, prev, j);
      if (!c) continue;
      // Cap each row so one odd row (an animation, a hover) can't sink a true shift.
      total += Math.min(c.mean, 32);
      n++;
    }
    if (n < Math.min(MIN_CHECKED, sample.length)) continue;
    ranked.push({ d, mean: total / n });
  }
  ranked.sort((x, y) => x.mean - y.mean || Math.abs(x.d) - Math.abs(y.d));
  let best: { d: number; mean: number } | null = null;
  for (const { d } of ranked.slice(0, FINALISTS)) {
    const s = score(prev, next, start, end, d);
    if (s.checked < MIN_CHECKED || s.match < MIN_MATCH) continue;
    if (!best || s.mean < best.mean || (s.mean === best.mean && Math.abs(d) < Math.abs(best.d)))
      best = { d, mean: s.mean };
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
  /** The last frame placed in the stitch; frames are matched against it. */
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

  /** The stitch reached the height limit: later frames add nothing. */
  get full(): boolean {
    return this.height >= this.maxHeight;
  }

  /** Output areas that still show the pointer (for tests and diagnostics). */
  get pointerAreas(): readonly Area[] {
    return this.dirty;
  }

  /**
   * Adds a frame and returns how many rows it added, or null if it doesn't
   * overlap the last placed frame (scrolled too far between samples). The
   * stitch is kept, and frames match again once the view is back over it.
   * `pointer` is where the mouse pointer may be drawn into the frame.
   */
  push(frame: RgbaFrame, pointer: readonly Area[] = []): number | null {
    if (frame.width !== this.width || frame.height !== this.frameHeight)
      throw new Error('Frame size changed');
    const profile = profileOf(frame, pointer);
    if (!this.last) {
      const rows = Math.min(frame.height, this.maxHeight);
      this.append(frame, 0, rows);
      this.markDirty(pointer, 0, rows);
      this.last = { frame, profile };
      return rows;
    }
    const found = findShift(this.last.profile, profile, frame.height);
    // At the height limit nothing more is added, so a lost overlap no longer matters.
    if (!found) return this.full ? 0 : null;
    if (found.shift > 0 && this.footer === 0 && found.fixedBottom > 0) {
      // The first frame's bottom rows were a sticky footer: hold them back until the end.
      this.trimRows(found.fixedBottom);
      this.footer = found.fixedBottom;
    }
    const end = frame.height - this.footer;
    // The content moved by `shift`, wherever appending stopped and whichever way it went.
    this.offset += found.shift;
    // Frame rows past the end of the stitch are new; scrolling back up reveals none.
    const from = Math.max(0, this.rows - this.offset);
    const take = Math.max(0, Math.min(end - from, this.maxHeight - this.height));
    this.append(frame, from, take);
    this.markDirty(pointer, from, from + take);
    // Also at the height limit: frames still clear the pointer from rows already kept.
    this.repair(frame, pointer, found.fixedTop, end);
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
  private markDirty(pointer: readonly Area[], from: number, to: number): void {
    for (const area of pointer) {
      const top = Math.max(from, Math.floor(area.top));
      const bottom = Math.min(to, Math.ceil(area.bottom));
      const left = Math.max(0, Math.floor(area.left));
      const right = Math.min(this.width, Math.ceil(area.right));
      if (top >= bottom || left >= right) continue;
      this.dirty.push({ top: top + this.offset, bottom: bottom + this.offset, left, right });
    }
  }

  /** Repaints the dirty rows this frame shows away from its own pointer; the rest stay dirty. */
  private repair(
    frame: RgbaFrame,
    pointer: readonly Area[],
    contentTop: number,
    contentEnd: number,
  ): void {
    if (this.dirty.length === 0) return;
    const rowBytes = this.width * 4;
    const left: Area[] = [];
    for (const area of this.dirty) {
      // Pointer areas of this frame that share columns with the dirty area.
      const blocking = pointer.filter((p) => area.left < p.right && area.right > p.left);
      let run: Area | null = null;
      for (let row = area.top; row < area.bottom; row++) {
        const y = row - this.offset;
        const visible =
          y >= contentTop && y < contentEnd && !blocking.some((p) => y >= p.top && y < p.bottom);
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
