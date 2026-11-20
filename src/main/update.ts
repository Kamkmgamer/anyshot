import { app, type BrowserWindow } from 'electron';
import {
  canSelfUpdate,
  checkForUpdate,
  type UpdateOffer,
  type UpdateStatus,
} from '../shared/update';
import { handle } from './ipc';
import { isTest } from './paths';
import { getSettings } from './settings-store';
import { createWindow, send } from './windows';

/** The part of electron-updater the app uses; tests substitute a fake. */
export interface Updater {
  /** The newer release, or null when this is the latest. Rejects when offline. */
  check(): Promise<{ version: string; releaseNotes: string | null } | null>;
  download(onProgress: (percent: number) => void): Promise<void>;
  /** Quits, installs and restarts. */
  install(): void;
}

/**
 * electron-updater, loaded only in packaged builds. It reads app-update.yml
 * (the GitHub releases of this repo) and the release's latest.yml (Windows) or
 * latest-linux.yml. Nothing downloads until the user chooses Update.
 */
async function electronUpdater(): Promise<Updater> {
  const { autoUpdater } = await import('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  return {
    async check() {
      const result = await autoUpdater.checkForUpdates();
      if (!result?.isUpdateAvailable) return null;
      const notes = result.updateInfo.releaseNotes;
      return {
        version: result.updateInfo.version,
        releaseNotes:
          typeof notes === 'string' ? notes : (notes?.map((n) => n.note ?? '').join('\n') ?? null),
      };
    },
    async download(onProgress) {
      const listener = (progress: { percent: number }) => onProgress(progress.percent);
      autoUpdater.on('download-progress', listener);
      try {
        await autoUpdater.downloadUpdate();
      } finally {
        autoUpdater.off('download-progress', listener);
      }
    },
    install() {
      // Silent: the installer already ran once with the user's choices; then restart.
      autoUpdater.quitAndInstall(true, true);
    },
  };
}

let updater: Updater | null = null;
let offer: UpdateOffer | null = null;
let status: UpdateStatus = { state: 'idle' };
let win: BrowserWindow | null = null;

/** Tests drive the update window with a fake updater. */
export function useUpdater(next: Updater): void {
  updater = next;
}

/**
 * Looks for a newer release once, a little after startup. Only packaged builds
 * check (not `electron .` in development or the e2e suite), and only when the
 * user allows it; offline or failed checks are logged and otherwise ignored.
 */
export async function checkAtStartup(): Promise<void> {
  const enabled = app.isPackaged && !isTest && getSettings().general.checkForUpdates;
  if (!enabled) return;
  try {
    updater ??= await electronUpdater();
  } catch (error) {
    console.warn('[update] updater unavailable', error);
    return;
  }
  const current = updater;
  await checkForUpdate({
    enabled,
    current: app.getVersion(),
    canInstall: canSelfUpdate(process.platform, process.env),
    check: () => current.check(),
    offer: showUpdate,
    log: (message) => console.warn(`[update] ${message}`),
  });
}

/** Shows the small update window for an offer (or brings it forward). */
export function showUpdate(next: UpdateOffer): void {
  offer = next;
  if (win && !win.isDestroyed()) {
    setStatus({ state: 'idle' });
    win.show();
    return;
  }
  status = { state: 'idle' };
  const created = createWindow('update', {
    width: 440,
    height: 320,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    center: true,
    title: 'anyshot update',
    backgroundColor: '#18181b',
  });
  win = created;
  created.once('ready-to-show', () => created.show());
  created.once('closed', () => {
    if (win === created) win = null;
  });
}

function setStatus(next: UpdateStatus): void {
  status = next;
  send(win, 'update:status', next);
}

handle('update:init', () => {
  if (!offer) throw new Error('No update to show');
  return { offer, status };
});

handle('update:install', async () => {
  if (!offer?.canInstall || !updater) return;
  if (status.state === 'downloading' || status.state === 'installing') return;
  const current = updater;
  setStatus({ state: 'downloading', percent: 0 });
  try {
    await current.download((percent) =>
      setStatus({ state: 'downloading', percent: Math.max(0, Math.min(100, percent)) }),
    );
    setStatus({ state: 'installing' });
    current.install();
  } catch (error) {
    setStatus({
      state: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
