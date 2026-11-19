import { randomUUID } from 'node:crypto';
import { type BrowserWindow, screen } from 'electron';
import type { FloatingItem, HistoryEntry } from '../shared/ipc';
import { release, retain } from './history';
import { handle } from './ipc';
import './item-actions';
import { getSettings } from './settings-store';
import { createWindow, send } from './windows';

// One small window in a screen corner shows every recent capture preview,
// instead of one renderer per preview.
const CARD_WIDTH = 240;
const CARD_HEIGHT = 150;
const GAP = 10;
const MARGIN = 16;
const MAX_VISIBLE = 4;

let items: FloatingItem[] = [];
let win: BrowserWindow | null = null;

export async function showFloating(entry: HistoryEntry): Promise<void> {
  retain(entry.id);
  if (getSettings().capture.thumbnailStacking === 'replace') {
    for (const item of items) release(item.historyId);
    items = [];
  }
  items = [
    {
      id: randomUUID(),
      historyId: entry.id,
      width: entry.width,
      height: entry.height,
      createdAt: entry.createdAt,
    },
    ...items,
  ].slice(0, MAX_VISIBLE);
  sync();
}

function bounds() {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = CARD_WIDTH + MARGIN * 2;
  const height = items.length * CARD_HEIGHT + (items.length - 1) * GAP + MARGIN * 2;
  const corner = getSettings().capture.thumbnailCorner;
  const x = corner.endsWith('left') ? workArea.x : workArea.x + workArea.width - width;
  const y = corner.startsWith('top') ? workArea.y : workArea.y + workArea.height - height;
  return { x, y, width, height };
}

function sync(): void {
  if (items.length === 0) {
    win?.destroy();
    win = null;
    return;
  }
  if (!win || win.isDestroyed()) {
    win = createWindow('floating', {
      ...bounds(),
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      // A preview must never take focus from the app the user is working in.
      focusable: false,
    });
    const current = win;
    current.setAlwaysOnTop(true, 'floating');
    current.once('ready-to-show', () => current.showInactive());
    current.once('closed', () => {
      if (win === current) {
        for (const item of items) release(item.historyId);
        items = [];
        win = null;
      }
    });
    return;
  }
  win.setBounds(bounds());
  send(win, 'floating:items', items);
}

export function dismissFloating(id: string): void {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  items = items.filter((i) => i.id !== id);
  release(item.historyId);
  sync();
}

/** Drops previews of a history entry (after it was deleted or opened elsewhere). */
export function dismissEntry(historyId: string): void {
  for (const item of items.filter((i) => i.historyId === historyId)) dismissFloating(item.id);
}

handle('floating:ready', () => ({
  items,
  dismissSeconds: getSettings().capture.thumbnailDismissSeconds,
}));
handle('floating:dismiss', (id) => dismissFloating(id));
