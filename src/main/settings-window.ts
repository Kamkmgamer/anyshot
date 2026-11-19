import { dialog } from 'electron';
import { handle } from './ipc';
import './secrets';
import { patchSettings } from './settings-store';
import './uploads';
import { createWindow, focusExisting } from './windows';

export async function openSettings(): Promise<void> {
  if (focusExisting('settings')) return;
  const win = createWindow('settings', {
    width: 760,
    height: 620,
    minWidth: 640,
    minHeight: 480,
    title: 'anyshot settings',
    backgroundColor: '#18181b',
  });
  win.once('ready-to-show', () => win.show());
}

handle('settings:choose-dir', async (which, { win }) => {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
  });
  const dir = result.canceled ? null : (result.filePaths[0] ?? null);
  if (!dir) return null;
  await patchSettings(
    which === 'output' ? { output: { saveDir: dir } } : { recording: { saveDir: dir } },
  );
  return dir;
});
