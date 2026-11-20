// Derives the tray icons from the app logo (resources/icon-256.png).
// The logo itself is hand-made: resources/icon.png (1024 px, installers) and icon-256.png.
// Run with Electron, which provides the image scaler: `bun run icons`.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, nativeImage } from 'electron';

const dir = join(import.meta.dirname, '..', 'resources');

/** Paints a red "recording" dot with a white ring in the bottom-right corner (BGRA). */
function withDot(image) {
  const { width: size } = image.getSize();
  const bgra = Buffer.from(image.toBitmap());
  const cx = size * 0.72;
  const cy = size * 0.72;
  const ring = size * 0.28;
  const dot = size * 0.2;
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inRing = 0;
      let inDot = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const d = Math.hypot(x + (sx + 0.5) / SS - cx, y + (sy + 0.5) / SS - cy);
          if (d <= ring) inRing++;
          if (d <= dot) inDot++;
        }
      }
      if (inRing === 0) continue;
      const ringCover = inRing / (SS * SS);
      const dotCover = inDot / (SS * SS);
      // White ring, then the red dot over it ([B, G, R] of #ef4444).
      const color = [255, 255, 255].map((w, k) => w * (1 - dotCover) + [68, 68, 239][k] * dotCover);
      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++)
        bgra[i + k] = Math.round(color[k] * ringCover + bgra[i + k] * (1 - ringCover));
      bgra[i + 3] = Math.round(255 * ringCover + bgra[i + 3] * (1 - ringCover));
    }
  }
  return nativeImage.createFromBitmap(bgra, { width: size, height: size });
}

app.whenReady().then(() => {
  const logo = nativeImage.createFromPath(join(dir, 'icon-256.png'));
  if (logo.isEmpty()) throw new Error('resources/icon-256.png is missing');
  for (const [name, size] of [
    ['tray.png', 16],
    ['tray@2x.png', 32],
  ]) {
    const small = logo.resize({ width: size, height: size, quality: 'best' });
    writeFileSync(join(dir, name), small.toPNG());
    writeFileSync(join(dir, name.replace('tray', 'tray-recording')), withDot(small).toPNG());
  }
  console.log('tray icons written to', dir);
  app.quit();
});
