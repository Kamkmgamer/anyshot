import type { BrowserWindow, Display } from 'electron';
import { evenRect, type Rect, scaleRect } from '../shared/geometry';
import type { ScrollInit } from '../shared/ipc';
import { setCaptureDisplay } from './display-media';
import { handle } from './ipc';
import { getSettings } from './settings-store';
import { createWindow } from './windows';

const HUD = { width: 360, height: 56, gap: 10 };

let active: { win: BrowserWindow; init: ScrollInit } | null = null;

/**
 * Scroll capture: a small control window sits just outside the region (so it
 * is never in the frames) while the user scrolls; frames are stitched in a worker.
 */
export async function startScrollCapture(display: Display, rect: Rect): Promise<void> {
  if (active) return;
  setCaptureDisplay(display.id);
  const { bounds, scaleFactor, workArea } = display;
  const init: ScrollInit = {
    displayId: display.id,
    displaySize: {
      width: Math.round(bounds.width * scaleFactor),
      height: Math.round(bounds.height * scaleFactor),
    },
    crop: evenRect(scaleRect(rect, scaleFactor)),
    scaleFactor,
    maxHeight: getSettings().scroll.maxHeight,
  };
  const below = bounds.y + rect.y + rect.height + HUD.gap;
  const above = bounds.y + rect.y - HUD.gap - HUD.height;
  const y =
    below + HUD.height <= workArea.y + workArea.height ? below : Math.max(workArea.y, above);
  const x = Math.round(
    Math.min(
      workArea.x + workArea.width - HUD.width,
      Math.max(workArea.x, bounds.x + rect.x + rect.width / 2 - HUD.width / 2),
    ),
  );
  const win = createWindow('scroll', {
    x,
    y: Math.round(y),
    width: HUD.width,
    height: HUD.height,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    // Frames must keep flowing while the user works in another window.
    webPreferences: { backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // Show without focus so the page being scrolled keeps keyboard and wheel focus.
  win.once('ready-to-show', () => win.showInactive());
  active = { win, init };
  win.once('closed', () => {
    if (active?.win === win) active = null;
  });
}

handle('scroll:init', (_req, { win }) => {
  if (!active || active.win !== win) throw new Error('No scroll capture');
  return active.init;
});

handle('scroll:finish', async ({ image, thumb }, { win }) => {
  win.destroy();
  if (!image) return;
  const { deliver } = await import('./deliver');
  await deliver({ action: 'quick', image, ...(thumb ? { thumb } : {}) });
});
