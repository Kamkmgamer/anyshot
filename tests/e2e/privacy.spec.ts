import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { packProject } from '../../src/shared/project';
import { dispatch, type Launched, launch, pageOf, pressClosing, windowKinds } from './harness';

// Censors must hide what they cover in every export, whichever renderer runs
// (WebGL, or Canvas 2D when WebGL is unavailable): a magnifier over a censor
// must show the censored pixels, and a crop that cuts through a censor must not
// leave a strip of the original visible.

const W = 400;
const H = 300;
/** Left half: 1px black/white stripes, the "secret" a pixelate or blur censor covers. */
const STRIPES = { x: 0, y: 0, width: 200, height: H };
/** Pure red, the "secret" under a solid censor with a magnifier on top. */
const RED = { x: 260, y: 100, width: 80, height: 80 };
const TRANSPARENT = { x: 215, y: 100, width: 24, height: 24 };
const FRACTIONAL = { x: 360.7, y: 100.7, width: 10.5, height: 10.5 };
const CROP = { x: 51, y: 20, width: W - 51, height: H - 40 };

function pixel(x: number, y: number): [number, number, number, number] {
  if (
    x >= TRANSPARENT.x &&
    x < TRANSPARENT.x + TRANSPARENT.width &&
    y >= TRANSPARENT.y &&
    y < TRANSPARENT.y + TRANSPARENT.height
  ) {
    return x === TRANSPARENT.x && y === TRANSPARENT.y ? [255, 0, 0, 255] : [0, 0, 0, 0];
  }
  if ((x === 360 && y === 100) || (x === 371 && y === 111)) return [255, 0, 0, 255];
  if (x < STRIPES.width) return x % 2 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255];
  const red = x >= RED.x && x < RED.x + RED.width && y >= RED.y && y < RED.y + RED.height;
  return red ? [255, 0, 0, 255] : [128, 128, 128, 255];
}

function projectDoc(mode: 'pixelate' | 'blur') {
  return {
    version: 1,
    unit: 1,
    crop: CROP,
    annotations: [
      { id: 'c1', kind: 'censor', rect: STRIPES, mode },
      { id: 'c2', kind: 'censor', rect: { x: 250, y: 90, width: 100, height: 100 }, mode: 'solid' },
      { id: 'c3', kind: 'censor', rect: TRANSPARENT, mode: 'pixelate' },
      { id: 'c4', kind: 'censor', rect: FRACTIONAL, mode: 'solid' },
      // Reads 275..325 × 115..165, all of it under the solid censor.
      { id: 'm1', kind: 'magnify', at: { x: 300, y: 140 }, radius: 50, zoom: 2, color: '#ffffff' },
    ],
  };
}

async function writeProject(ctx: Launched, mode: 'pixelate' | 'blur'): Promise<string> {
  const bgra = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [r, g, b, a] = pixel(x, y);
      bgra.set([b, g, r, a], (y * W + x) * 4);
    }
  const png = await ctx.app.evaluate(
    ({ nativeImage }, [base64, width, height]) =>
      nativeImage
        .createFromBitmap(Buffer.from(base64, 'base64'), { width, height })
        .toPNG()
        .toString('base64'),
    [bgra.toString('base64'), W, H] as const,
  );
  const file = join(ctx.userData, `${mode}.anyshot`);
  const bytes = packProject({
    doc: projectDoc(mode),
    image: { mime: 'image/png', width: W, height: H },
    bytes: Buffer.from(png, 'base64'),
  });
  await writeFile(file, bytes);
  return file;
}

/** The PNG on the clipboard as RGB rows. */
async function clipboardImage(ctx: Launched) {
  const shot = await ctx.app.evaluate(async ({ clipboard, nativeImage }) => {
    for (const item of await clipboard.read()) {
      if (!item.types.includes('image/png')) continue;
      const blob = (await item.getType('image/png')) as Blob;
      const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
      return { size: image.getSize(), bgra: image.toBitmap().toString('base64') };
    }
    return null;
  });
  if (!shot) throw new Error('no image on the clipboard');
  const bgra = Buffer.from(shot.bgra, 'base64');
  const { width, height } = shot.size;
  const at = (x: number, y: number): [number, number, number] => {
    const i = (y * width + x) * 4;
    return [bgra[i + 2] ?? -1, bgra[i + 1] ?? -1, bgra[i] ?? -1];
  };
  return { width, height, at };
}

for (const webgl of [true, false]) {
  test(`censors hide their content in exports (${webgl ? 'WebGL' : 'Canvas 2D'})`, async () => {
    // Without a GPU or software rasterizer Chromium has no WebGL at all.
    const ctx = await launch(
      webgl
        ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']
        : ['--disable-gpu', '--disable-software-rasterizer'],
    );
    try {
      await ctx.app.evaluate(async () => {
        await globalThis.__anyshot?.patch({ capture: { showThumbnail: false } });
      });
      for (const mode of ['pixelate', 'blur'] as const) {
        await ctx.app.evaluate(({ clipboard }) => clipboard.clear());
        await dispatch(ctx.app, 'openImage', await writeProject(ctx, mode));
        const editor = await pageOf(ctx.app, 'editor');
        await expect(editor.getByTestId('editor-size')).toHaveText(
          `${CROP.width} × ${CROP.height}`,
        );
        const available = await editor.evaluate(
          () => new OffscreenCanvas(1, 1).getContext('webgl') !== null,
        );
        expect(available).toBe(webgl);
        const protectedPixels = [
          [215, 100],
          [360, 100],
          [371, 111],
        ] as const;
        await expect
          .poll(() =>
            editor.locator('.layer-committed').evaluate((canvas: HTMLCanvasElement, points) => {
              const ctx = canvas.getContext('2d');
              return points.map(([x, y]) => Array.from(ctx?.getImageData(x, y, 1, 1).data ?? []));
            }, protectedPixels),
          )
          .toEqual([
            [0, 0, 0, 255], // The preview base is opaque, so transparent source pixels are black.
            [17, 17, 17, 255],
            [17, 17, 17, 255],
          ]);
        await editor.getByTestId('editor-copy').click();
        await expect(editor.getByTestId('editor-status')).toHaveText('Copied to the clipboard');
        const out = await clipboardImage(ctx);
        expect({ width: out.width, height: out.height }).toEqual({
          width: CROP.width,
          height: CROP.height,
        });

        // Red marks the secrets under the magnifier, the transparent pixelated region,
        // and both intersecting edges of the fractional solid censor.
        const red: string[] = [];
        for (let y = 0; y < out.height; y++)
          for (let x = 0; x < out.width; x++) {
            const [r, g, b] = out.at(x, y);
            if (r > 160 && g < 90 && b < 90) red.push(`${x},${y}`);
          }
        expect(red.slice(0, 5), `${mode}: red pixels`).toEqual([]);
        for (const [x, y] of protectedPixels) {
          expect(out.at(x - CROP.x, y - CROP.y)).toEqual([17, 17, 17]);
        }

        // No stripe survives: in the original every pixel differs from both
        // horizontal neighbours; censored, each matches at least one of them.
        const stripes: string[] = [];
        const right = STRIPES.width - CROP.x;
        const close = (a: number[], b: number[]) =>
          a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 48);
        for (let y = 0; y < out.height; y++)
          for (let x = 1; x < right - 2; x++) {
            const p = out.at(x, y);
            if (!close(p, out.at(x - 1, y)) && !close(p, out.at(x + 1, y)))
              stripes.push(`${x},${y}`);
          }
        expect(stripes.slice(0, 5), `${mode}: original stripes`).toEqual([]);
        await pressClosing(editor, 'Control+w');
        await expect.poll(() => windowKinds(ctx.app)).toEqual([]);
      }
      expect(ctx.errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}
