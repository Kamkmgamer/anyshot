import { type BrowserWindow, nativeImage, type Rectangle, screen } from 'electron';
import type { HistoryEntry, PinInit } from '../shared/ipc';
import { readPng } from './clipboard';
import { addEntry, getRetainedEntry, release } from './history';
import { handle } from './ipc';
import './item-actions';
import { getSettings } from './settings-store';
import { createWindow } from './windows';

const pins = new Map<number, HistoryEntry>();

/** Shows a capture as an always-on-top window, where it was taken or centred. */
export async function pinEntry(
  id: string,
  screenRect?: Rectangle,
): Promise<BrowserWindow | undefined> {
  const entry = await getRetainedEntry(id);
  if (!entry) return undefined;
  try {
    return openPin(entry, screenRect);
  } catch (error) {
    release(id);
    throw error;
  }
}

function openPin(entry: HistoryEntry, screenRect?: Rectangle): BrowserWindow {
  const display = screenRect
    ? screen.getDisplayMatching(screenRect)
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { workArea, scaleFactor } = display;
  let width = screenRect?.width ?? entry.width / scaleFactor;
  let height = screenRect?.height ?? entry.height / scaleFactor;
  const fit = Math.min(1, (workArea.width * 0.9) / width, (workArea.height * 0.9) / height);
  width = Math.max(40, Math.round(width * fit));
  height = Math.max(30, Math.round(height * fit));
  const inPlace = screenRect && getSettings().capture.pinPlacement === 'original';
  const x = inPlace ? screenRect.x : Math.round(workArea.x + (workArea.width - width) / 2);
  const y = inPlace ? screenRect.y : Math.round(workArea.y + (workArea.height - height) / 2);
  const win = createWindow('pin', {
    x,
    y,
    width,
    height,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    transparent: true,
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true);
  const id = win.webContents.id;
  pins.set(id, entry);
  win.once('closed', () => {
    pins.delete(id);
    release(entry.id);
  });
  return win;
}

export async function pinClipboard(): Promise<void> {
  const png = await readPng();
  if (!png) {
    const { Notification } = await import('electron');
    new Notification({ title: 'anyshot', body: 'The clipboard has no image to pin.' }).show();
    return;
  }
  const size = nativeImage.createFromBuffer(Buffer.from(png)).getSize();
  const entry = await addEntry({ png, width: size.width, height: size.height });
  try {
    await pinEntry(entry.id);
  } finally {
    release(entry.id);
  }
}

handle('pin:init', (_req, { win }): PinInit => {
  const entry = pins.get(win.webContents.id);
  if (!entry) throw new Error('Unknown pin');
  return {
    src: `/@history/${entry.id}/image`,
    width: entry.width,
    height: entry.height,
    historyId: entry.id,
  };
});

handle('pin:ready', (_req, { win }) => {
  if (!win.isVisible()) win.show();
});

handle('pin:move-by', ({ dx, dy }, { win }) => {
  const [x = 0, y = 0] = win.getPosition();
  win.setPosition(Math.round(x + dx), Math.round(y + dy));
});
