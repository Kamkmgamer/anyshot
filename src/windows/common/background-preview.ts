import { drawBackground } from '../../engine/background-render';
import type { Background } from '../../shared/background';

interface Preview {
  background: Background;
  width: number;
  height: number;
  image: HTMLImageElement | null;
}

const previews = new WeakMap<HTMLCanvasElement, Preview>();

export function paintBackgroundPreview(
  canvas: HTMLCanvasElement,
  background: Background,
  width: number,
  height: number,
): void {
  const previous = previews.get(canvas);
  if (previous?.background === background && previous.width === width && previous.height === height)
    return;
  const data =
    typeof background === 'number' || background.kind !== 'image' ? null : background.data;
  const image = data ? (previous?.image?.src === data ? previous.image : new Image()) : null;
  const preview = { background, width, height, image };
  previews.set(canvas, preview);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const paint = () => {
    if (previews.get(canvas) === preview) {
      drawBackground(ctx, background, width, height, image?.naturalWidth ? image : null);
    }
  };
  if (image && data) {
    image.onload = paint;
    if (image.src !== data) image.src = data;
  }
  paint();
}
