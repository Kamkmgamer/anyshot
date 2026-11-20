import { describe, expect, it } from 'vitest';
import {
  findShift,
  pointerAreas,
  profileOf,
  type RgbaFrame,
  Stitcher,
} from '../../src/shared/stitch';

const W = 120;

/** A deterministic "web page": text-like dashes, blank gaps and blocks of colour. */
function page(height: number, seed = 7): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * height * 4).fill(255);
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let y = 0; y < height; y++) {
    const line = Math.floor(y / 14);
    const inText = y % 14 < 9 && line % 5 !== 4;
    const start = Math.floor(rand() * 20);
    const len = 30 + Math.floor(rand() * 80);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (inText && x >= start && x < start + len && (x + line) % 7 !== 0) {
        data[i] = data[i + 1] = data[i + 2] = 40 + ((line * 37) % 120);
      }
    }
  }
  return data;
}

/** Draws a mouse pointer (dark, 8 × 20 px) at a fixed spot of the frame, as screen captures do. */
const SPOT = { x: 50, y: 90 };
function withPointer(f: RgbaFrame): RgbaFrame {
  const data = f.data.slice(0);
  for (let y = SPOT.y; y < SPOT.y + 20; y++)
    for (let x = SPOT.x; x < SPOT.x + 8 - Math.floor((y - SPOT.y) / 3); x++) {
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  return { ...f, data };
}

function view(
  src: Uint8ClampedArray,
  top: number,
  height: number,
  header = 0,
  footer = 0,
): RgbaFrame {
  const data = new Uint8ClampedArray(W * height * 4);
  data.set(src.subarray(top * W * 4, (top + height) * W * 4));
  for (let y = 0; y < header; y++) data.fill(80, y * W * 4, (y + 1) * W * 4); // sticky header
  for (let y = height - footer; y < height; y++) data.fill(200, y * W * 4, (y + 1) * W * 4);
  return { data, width: W, height };
}

/** Simulates video noise: small luma jitter like YUV conversion leaves behind. */
function noisy(f: RgbaFrame): RgbaFrame {
  const data = f.data.slice(0);
  for (let i = 0; i < data.length; i += 4) {
    const n = ((i / 4) % 3) - 1;
    data[i] = Math.max(0, Math.min(255, (data[i] ?? 0) + n));
    data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] ?? 0) + n));
  }
  return { ...f, data };
}

describe('scroll stitching', () => {
  it('finds the scroll distance between two frames', () => {
    const src = page(600);
    const a = profileOf(view(src, 0, 200));
    for (const d of [1, 13, 57, 150]) {
      expect(findShift(a, profileOf(view(src, d, 200)), 200)?.shift).toBe(d);
    }
    expect(findShift(a, a, 200)?.shift).toBe(0);
  });

  it('rebuilds the page from overlapping frames, despite noise', () => {
    const src = page(700);
    const stitcher = new Stitcher(W, 200, 10_000);
    for (const top of [0, 40, 95, 180, 300, 420, 500]) stitcher.push(noisy(view(src, top, 200)));
    const out = stitcher.result();
    expect(out.height).toBe(700);
    // Rows of the result match the source page (allowing the injected noise).
    let maxDiff = 0;
    for (let i = 0; i < src.length; i += 4)
      maxDiff = Math.max(maxDiff, Math.abs((out.data[i + 2] ?? 0) - (src[i + 2] ?? 0)));
    expect(maxDiff).toBe(0);
  });

  it('keeps a sticky header once and a sticky footer at the end', () => {
    const src = page(600);
    const stitcher = new Stitcher(W, 200, 10_000);
    for (const top of [0, 60, 130, 220]) stitcher.push(view(src, top, 200, 20, 16));
    const out = stitcher.result();
    // Content scrolled 220 rows: header + all content rows + footer.
    expect(out.height).toBe(200 + 220);
    const rowValue = (y: number) => out.data[(y * W + 5) * 4];
    expect(rowValue(0)).toBe(80);
    expect(rowValue(out.height - 1)).toBe(200);
    expect(rowValue(out.height - 17)).not.toBe(200);
  });

  it('ignores frames that did not scroll and stops at the height limit', () => {
    const src = page(800);
    const stitcher = new Stitcher(W, 200, 300);
    expect(stitcher.push(view(src, 0, 200))).toBe(200);
    expect(stitcher.push(view(src, 0, 200))).toBe(0);
    stitcher.push(view(src, 150, 200));
    stitcher.push(view(src, 300, 200));
    expect(stitcher.result().height).toBe(300);
  });

  it('distinguishes lost overlap from an unchanged frame', () => {
    const src = page(600);
    const stitcher = new Stitcher(W, 200, 1000);
    expect(stitcher.push(view(src, 0, 200))).toBe(200);
    expect(stitcher.push(view(src, 0, 200))).toBe(0);
    expect(stitcher.push(view(src, 200, 200))).toBeNull();
    expect(stitcher.push(view(src, 220, 200))).toBeNull();
  });

  it('honors the height limit even when the first viewport is taller', () => {
    const src = page(600);
    const stitcher = new Stitcher(W, 200, 100);
    expect(stitcher.push(view(src, 0, 200))).toBe(100);
    expect(stitcher.push(view(src, 100, 200))).toBe(0);
    const result = stitcher.result();
    expect(result.height).toBe(100);
    expect(result.data).toEqual(src.subarray(0, 100 * W * 4));
  });

  it('ignores the mouse pointer drawn into every frame and repaints it from later frames', () => {
    const src = page(700);
    // Steps well under the frame height, as sampling every 150 ms gives.
    const tops = [0, 40, 80, 125, 170, 210, 250, 300, 340, 380, 420, 460, 500];
    // Without knowing where the pointer is, the frames don't match.
    const blind = new Stitcher(W, 200, 10_000);
    blind.push(withPointer(view(src, 0, 200)));
    expect(blind.push(withPointer(view(src, 40, 200)))).toBeNull();

    const area = pointerAreas([SPOT], 1, W, 200);
    const stitcher = new Stitcher(W, 200, 10_000);
    for (const top of tops)
      expect(stitcher.push(withPointer(view(src, top, 200)), area)).not.toBeNull();
    const out = stitcher.result();
    expect(out.height).toBe(700);
    // Every row the pointer covered was later seen without it, so none is left.
    expect(stitcher.pointerAreas).toEqual([]);
    expect(out.data).toEqual(src);
  });

  it('keeps the stitch after lost overlap and continues once frames overlap again', () => {
    const src = page(600);
    const stitcher = new Stitcher(W, 200, 1000);
    stitcher.push(view(src, 0, 200));
    expect(stitcher.push(view(src, 250, 200))).toBeNull();
    expect(stitcher.height).toBe(200);
    expect(stitcher.push(view(src, 120, 200))).toBe(120);
    expect(stitcher.result().data).toEqual(src.subarray(0, 320 * W * 4));
  });

  it('places a pointer area around each recent spot, clamped to the frame', () => {
    expect(pointerAreas([], 1, 100, 100)).toEqual([]);
    expect(pointerAreas([{ x: 50, y: 40 }], 2, 100, 100)).toEqual([
      { top: 16, bottom: 100, left: 26, right: 100 },
    ]);
    // It moved between samples: each spot gets its own area.
    expect(
      pointerAreas(
        [
          { x: 20, y: 20 },
          { x: 30, y: 25 },
        ],
        1,
        200,
        200,
      ),
    ).toEqual([
      { top: 8, bottom: 64, left: 8, right: 56 },
      { top: 13, bottom: 69, left: 18, right: 66 },
    ]);
    // Outside the frame.
    expect(pointerAreas([{ x: -100, y: 50 }], 1, 100, 100)).toEqual([]);
  });

  it('still repaints the pointer once the height limit is reached', () => {
    const src = page(400);
    const stitcher = new Stitcher(W, 200, 200);
    // The first frame fills the limit and has the pointer in it.
    expect(stitcher.push(withPointer(view(src, 0, 200)), pointerAreas([SPOT], 1, W, 200))).toBe(
      200,
    );
    expect(stitcher.pointerAreas).not.toEqual([]);
    // The pointer moved away: a clean frame at the same scroll position repairs it, adding nothing.
    expect(stitcher.push(view(src, 0, 200), [])).toBe(0);
    expect(stitcher.pointerAreas).toEqual([]);
    expect(stitcher.result().data).toEqual(src.subarray(0, 200 * W * 4));
    // Scrolling further, even past any overlap, adds nothing and isn't reported as lost.
    expect(stitcher.push(view(src, 40, 200))).toBe(0);
    expect(stitcher.push(view(src, 200, 200))).toBe(0);
    expect(stitcher.height).toBe(200);
  });
});

/**
 * Smooth scrolling and display scaling paint content at sub-pixel offsets: the
 * edges of shapes are anti-aliased differently from frame to frame. Lightens the
 * top row of every text line, as a half-pixel offset does to a shape's edge.
 */
function subpixel(f: RgbaFrame, top: number): RgbaFrame {
  const data = f.data.slice(0);
  for (let y = 0; y < f.height; y++) {
    if ((top + y) % 14 !== 0) continue;
    for (let i = y * W * 4; i < (y + 1) * W * 4; i++) data[i] = 255 - ((255 - (data[i] ?? 0)) >> 1);
  }
  return { ...f, data };
}

describe('scroll stitching while scrolling slowly', () => {
  it('matches frames whose edges are anti-aliased differently (sub-pixel scroll offsets)', () => {
    const src = page(700);
    const tops = [0, 9, 21, 30, 47, 60, 75, 88, 102, 130, 166, 210, 260, 300, 345, 400, 450, 500];
    const stitcher = new Stitcher(W, 200, 10_000);
    tops.forEach((top, n) => {
      // Every other frame sits at a half-pixel offset.
      const frame = view(src, top, 200);
      expect(stitcher.push(n % 2 ? subpixel(frame, top) : frame)).not.toBeNull();
    });
    expect(stitcher.height).toBe(700);
  });

  it('ignores the pointer at both of its recent spots without hiding whole rows', () => {
    const src = page(500);
    // It was over on the right at the previous sample and is drawn at SPOT now.
    const spots = [{ x: 100, y: 10 }, SPOT];
    // The pointer moved between samples: one area per spot, not one box around both.
    const areas = pointerAreas(spots, 1, W, 200);
    expect(areas).toHaveLength(2);
    const stitcher = new Stitcher(W, 200, 10_000);
    for (const top of [0, 30, 70, 110, 150, 200, 260, 300])
      expect(stitcher.push(withPointer(view(src, top, 200)), areas)).not.toBeNull();
    expect(stitcher.height).toBe(500);
  });

  it('follows the view back up without adding rows, then continues down', () => {
    const src = page(600);
    const stitcher = new Stitcher(W, 200, 10_000);
    expect(stitcher.push(view(src, 0, 200))).toBe(200);
    expect(stitcher.push(view(src, 100, 200))).toBe(100);
    expect(stitcher.push(view(src, 60, 200))).toBe(0);
    expect(stitcher.push(view(src, 20, 200))).toBe(0);
    // Back down past the end: only rows past the stitch are new.
    expect(stitcher.push(view(src, 150, 200))).toBe(50);
    expect(stitcher.result().data).toEqual(src.subarray(0, 350 * W * 4));
  });

  it('treats a repaint without scrolling (hover, caret) as unchanged, not lost', () => {
    const src = page(600);
    const stitcher = new Stitcher(W, 200, 10_000);
    stitcher.push(view(src, 0, 200));
    const hovered = view(src, 0, 200);
    // A highlighted list row: 12 rows change colour.
    for (let i = 70 * W * 4; i < 82 * W * 4; i++) hovered.data[i] = (hovered.data[i] ?? 0) - 20;
    expect(stitcher.push(hovered)).toBe(0);
    expect(stitcher.push(view(src, 50, 200))).toBe(50);
  });

  it('recovers from lost overlap when the view comes back above the last matched frame', () => {
    const src = page(700);
    const stitcher = new Stitcher(W, 200, 10_000);
    stitcher.push(view(src, 0, 200));
    expect(stitcher.push(view(src, 120, 200))).toBe(120);
    // Scrolled too far at once, then back up past where it was matched last.
    expect(stitcher.push(view(src, 400, 200))).toBeNull();
    expect(stitcher.push(view(src, 80, 200))).toBe(0);
    expect(stitcher.push(view(src, 200, 200))).toBe(80);
    expect(stitcher.result().data).toEqual(src.subarray(0, 400 * W * 4));
  });

  it('reports when the height limit is reached', () => {
    const src = page(600);
    const stitcher = new Stitcher(W, 200, 260);
    stitcher.push(view(src, 0, 200));
    expect(stitcher.full).toBe(false);
    expect(stitcher.push(view(src, 100, 200))).toBe(60);
    expect(stitcher.full).toBe(true);
  });
});
