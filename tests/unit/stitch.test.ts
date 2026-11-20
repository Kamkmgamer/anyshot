import { describe, expect, it } from 'vitest';
import {
  findShift,
  pointerArea,
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

    const area = pointerArea([SPOT], 1, W, 200);
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

  it('places the pointer area around its recent spots, clamped to the frame', () => {
    expect(pointerArea([], 1, 100, 100)).toBeNull();
    expect(pointerArea([{ x: 50, y: 40 }], 2, 100, 100)).toEqual({
      top: 16,
      bottom: 100,
      left: 26,
      right: 100,
    });
    // It moved between samples: both spots are covered.
    expect(
      pointerArea(
        [
          { x: 20, y: 20 },
          { x: 30, y: 25 },
        ],
        1,
        200,
        200,
      ),
    ).toEqual({
      top: 8,
      bottom: 69,
      left: 8,
      right: 66,
    });
    // Outside the frame.
    expect(pointerArea([{ x: -100, y: 50 }], 1, 100, 100)).toBeNull();
  });
});
