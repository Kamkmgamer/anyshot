import { clearHistory, listEntries } from './history';
import { handle } from './ipc';
import './item-actions';
import { createWindow, focusExisting } from './windows';

export async function openHistory(): Promise<void> {
  if (focusExisting('history')) return;
  const win = createWindow('history', {
    width: 920,
    height: 600,
    minWidth: 520,
    minHeight: 360,
    title: 'anyshot history',
    backgroundColor: '#18181b',
  });
  win.once('ready-to-show', () => win.show());
}

handle('history:list', () => listEntries());
handle('history:clear', () => clearHistory());
