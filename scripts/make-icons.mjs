// Generates anyshot's original icons (tile + viewfinder brackets) as PNGs.
// Dependency-free: shapes are signed-distance functions, supersampled 4x4.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sdRoundBox = (x, y, half, r) => {
  const qx = Math.abs(x) - half + r;
  const qy = Math.abs(y) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdBox = (x, y, cx, cy, hw, hh) => {
  const qx = Math.abs(x - cx) - hw;
  const qy = Math.abs(y - cy) - hh;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
};
const lerp = (a, b, t) => a + (b - a) * t;

// Coordinates are in a unit square [-1, 1]. Returns [r, g, b, a] in 0..1.
function shade(x, y, palette, recording) {
  const tile = sdRoundBox(x, y, 0.94, 0.36);
  if (tile > 0) return null;
  const t = (y + 1) / 2;
  let color = palette.top.map((c, i) => lerp(c, palette.bottom[i], t));
  // Viewfinder brackets: four L shapes, stroke 0.13, arm 0.34, inset at 0.56.
  const s = 0.065;
  const arm = 0.17;
  const inset = 0.56;
  let bracket = Infinity;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const cx = sx * inset;
      const cy = sy * inset;
      bracket = Math.min(
        bracket,
        sdBox(x, y, cx - sx * (arm - s), cy, arm, s),
        sdBox(x, y, cx, cy - sy * (arm - s), s, arm),
      );
    }
  }
  const dot = Math.hypot(x, y) - (recording ? 0.3 : 0.15);
  if (Math.min(bracket, dot) <= 0) color = [1, 1, 1];
  return [...color, 1];
}

function render(size, palette, recording = false) {
  const rgba = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = ((px + (sx + 0.5) / ss) / size) * 2 - 1;
          const y = ((py + (sy + 0.5) / ss) / size) * 2 - 1;
          const c = shade(x, y, palette, recording);
          if (!c) continue;
          for (let i = 0; i < 3; i++) acc[i] += c[i] * c[3];
          acc[3] += c[3];
        }
      }
      const a = acc[3] / (ss * ss);
      const o = (py * size + px) * 4;
      if (acc[3] > 0) for (let i = 0; i < 3; i++) rgba[o + i] = Math.round((acc[i] / acc[3]) * 255);
      rgba[o + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, size, rgba);
}

const TEAL = { top: [0.18, 0.83, 0.75], bottom: [0.06, 0.46, 0.43] };
const RED = { top: [0.97, 0.36, 0.36], bottom: [0.73, 0.11, 0.11] };

const out = join(import.meta.dirname, '..', 'resources');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon.png'), render(512, TEAL));
writeFileSync(join(out, 'icon-256.png'), render(256, TEAL));
writeFileSync(join(out, 'tray.png'), render(16, TEAL));
writeFileSync(join(out, 'tray@2x.png'), render(32, TEAL));
writeFileSync(join(out, 'tray-recording.png'), render(16, RED, true));
writeFileSync(join(out, 'tray-recording@2x.png'), render(32, RED, true));
console.log('icons written to', out);
