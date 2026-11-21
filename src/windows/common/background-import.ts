import { DEFAULT_IMAGE, type ImageBackground, MAX_BACKGROUND_DATA } from '../../shared/background';

const MAX_IMPORT_SIZE = 30 * 1024 * 1024;

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(reader.error);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Keep a portable, bounded raster copy and discard metadata and animation. */
export async function importBackground(file: File): Promise<ImageBackground> {
  if (file.size > MAX_IMPORT_SIZE) throw new Error('Choose an image smaller than 30 MB.');
  const image = await createImageBitmap(file).catch(() => {
    throw new Error('Choose a readable PNG, JPEG, WebP, AVIF, GIF, or BMP image.');
  });
  try {
    for (const limit of [2560, 1920, 1280, 960]) {
      const scale = Math.min(1, limit / Math.max(image.width, image.height));
      const canvas = new OffscreenCanvas(
        Math.max(1, Math.round(image.width * scale)),
        Math.max(1, Math.round(image.height * scale)),
      );
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.88 });
      if (blob.type === 'image/webp' && (blob.size * 4) / 3 + 32 <= MAX_BACKGROUND_DATA) {
        return { ...DEFAULT_IMAGE, data: await dataUrl(blob) };
      }
    }
    throw new Error('Could not prepare this image. Try a smaller image.');
  } finally {
    image.close();
  }
}
