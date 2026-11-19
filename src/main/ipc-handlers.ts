import { shell } from 'electron';
import { copyText } from './clipboard';
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
  handle('clipboard:text', (text) => copyText(text));
  // Registered here, not by the capture session: editors opened from history,
  // files or the clipboard deliver too, without any capture having run.
  handle('capture:deliver', async (request, { kind, win }) => {
    // The overlay has already encoded everything it needs; close it right away.
    if (kind === 'overlay') (await import('./capture/session')).endCapture(win);
    return (await import('./deliver')).deliver(request);
  });
  handle('shell:open-url', async (url) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
  });
  onSettingsChanged((next) => broadcast('settings:changed', next));
}
