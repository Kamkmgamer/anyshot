import { createRequire } from 'node:module';
import { type Display, desktopCapturer } from 'electron';
import type { Frame } from '../frames';
import { bgraToRgba, matchMonitor } from './match';

type NodeScreenshots = typeof import('node-screenshots');

const isWayland = process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland';
const forced = process.env.ANYSHOT_CAPTURE_BACKEND;

let native: NodeScreenshots | null | undefined;

/** Loads node-screenshots on first use; null when unavailable (Wayland, missing binary). */
function nativeBackend(): NodeScreenshots | null {
  if (native !== undefined) return native;
  if (isWayland || forced === 'desktop-capturer') {
    native = null;
    return native;
  }
  try {
    native = createRequire(import.meta.url)('node-screenshots') as NodeScreenshots;
  } catch (error) {
    console.warn('[capture] node-screenshots unavailable, using desktopCapturer', error);
    native = null;
  }
  return native;
}

export function captureBackend(): 'node-screenshots' | 'desktop-capturer' {
  return nativeBackend() ? 'node-screenshots' : 'desktop-capturer';
}

/** Grabs one display at full physical resolution as raw RGBA. */
export async function grabDisplay(display: Display): Promise<Frame> {
  const ns = nativeBackend();
  if (ns) {
    try {
      const monitors = ns.Monitor.all();
      const monitor = matchMonitor(
        monitors.map((m) => ({
          id: m.id(),
          x: m.x(),
          y: m.y(),
          width: m.width(),
          height: m.height(),
          m,
        })),
        display,
      );
      if (monitor) {
        const image = await monitor.m.captureImage();
        const rgba = await image.toRaw();
        return { rgba, width: image.width, height: image.height };
      }
    } catch (error) {
      console.warn('[capture] native grab failed, falling back', error);
    }
  }
  return grabWithDesktopCapturer(display);
}

/**
 * Electron's own capturer. On Wayland this goes through the desktop's
 * screen-share portal and may show a system picker.
 */
async function grabWithDesktopCapturer(display: Display): Promise<Frame> {
  const width = Math.round(display.bounds.width * display.scaleFactor);
  const height = Math.round(display.bounds.height * display.scaleFactor);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  });
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!source) throw new Error('No screen source available');
  const image = source.thumbnail;
  const size = image.getSize();
  if (size.width === 0 || size.height === 0)
    throw new Error('Screen capture returned an empty image');
  return {
    rgba: bgraToRgba(new Uint8Array(image.toBitmap())),
    width: size.width,
    height: size.height,
  };
}
