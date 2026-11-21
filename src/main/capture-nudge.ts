import { BrowserWindow, type Rectangle } from 'electron';

const NUDGE_MS = 120;

/**
 * Windows screen capture sends a frame only when the compositor presents one, and when the
 * screen is still it sometimes doesn't send even the first frame: a recording then has no
 * video until something on the display changes (a still screen recorded for its whole length
 * has none at all). Showing a 1 × 1, nearly transparent, click-through window in a corner of
 * the display for a moment makes the compositor present a frame, so capture starts at once.
 * The window is outside any recorded area that doesn't include that corner pixel, and even
 * there it changes the pixel by 1/255.
 */
export function nudgeCapture(bounds: Rectangle): void {
  if (process.platform !== 'win32') return;
  const win = new BrowserWindow({
    x: bounds.x + bounds.width - 1,
    y: bounds.y + bounds.height - 1,
    width: 1,
    height: 1,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#01000000',
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.setIgnoreMouseEvents(true);
  win.showInactive();
  setTimeout(() => {
    if (!win.isDestroyed()) win.destroy();
  }, NUDGE_MS);
}
