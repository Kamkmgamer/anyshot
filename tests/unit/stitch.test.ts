import { describe, expect, it } from 'vitest';
import { findShift, type RgbaFrame, rowProfiles, Stitcher } from '../../src/shared/stitch';

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
    const a = rowProfiles(view(src, 0, 200));
    for (const d of [1, 13, 57, 150]) {
      expect(findShift(a, rowProfiles(view(src, d, 200)), 200)?.shift).toBe(d);
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
});
