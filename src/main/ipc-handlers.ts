import { clipboard, shell } from 'electron';
import { releaseFrame } from './frames';
import { handle } from './ipc';
import { getSettings, onSettingsChanged, patchSettings } from './settings-store';
import { broadcast } from './windows';

/** Handlers shared by all windows. Feature modules register their own on import. */
export function registerIpc(): void {
  handle('settings:get', () => getSettings());
  handle('settings:patch', (patch) => patchSettings(patch));
  handle('window:close', (_req, { win }) => win.close());
  handle('window:set-size', ({ width, height }, { win }) => {
    win.setContentSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  });
  handle('frame:release', (id) => releaseFrame(id));
  handle('clipboard:text', (text) => clipboard.writeText(text));
  handle('shell:open-url', async (url) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
  });
  onSettingsChanged((next) => broadcast('settings:changed', next));
}
