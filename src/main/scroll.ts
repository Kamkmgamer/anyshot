import { type BrowserWindow, type Display, Notification } from 'electron';
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
  const left = bounds.x + rect.x;
  const top = bounds.y + rect.y;
  const right = left + rect.width;
  const bottom = top + rect.height;
  const maxX = workArea.x + workArea.width - HUD.width;
  const maxY = workArea.y + workArea.height - HUD.height;
  const x = Math.min(maxX, Math.max(workArea.x, left + (rect.width - HUD.width) / 2));
  const y = Math.min(maxY, Math.max(workArea.y, top + (rect.height - HUD.height) / 2));
  const positions = [
    { x, y: bottom + HUD.gap },
    { x, y: top - HUD.height - HUD.gap },
    { x: right + HUD.gap, y },
    { x: left - HUD.width - HUD.gap, y },
  ];
  const position = positions.find(
    (p) => p.x >= workArea.x && p.x <= maxX && p.y >= workArea.y && p.y <= maxY,
  );
  if (!position) {
    new Notification({
      title: 'Could not start scroll capture',
      body: 'Select a smaller area to leave room for the scroll controls.',
    }).show();
    return;
  }
  const win = createWindow('scroll', {
    x: Math.round(position.x),
    y: Math.round(position.y),
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
  setCaptureDisplay(win.webContents, display.id);
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
