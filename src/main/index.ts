import { app, Menu } from 'electron';
import type { Settings } from '../shared/settings';
import { runAction, setCaptureDelay } from './actions';
import { onAppState } from './app-state';
import { type AppAction, parseCli } from './cli';
import { registerHotkeys, unregisterHotkeys } from './hotkeys';
import { registerIpc } from './ipc-handlers';
import { isTest } from './paths';
import { registerAppScheme } from './protocol';
import { getSettings, loadSettings, onSettingsChanged } from './settings-store';
import { createTray, trayTemplate, updateTray } from './tray';

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}

const isWayland = process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland';
if (isWayland) {
  // Lets globalShortcut go through the desktop's GlobalShortcuts portal.
  app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');
}
registerAppScheme();

function dispatch(action: AppAction, file?: string): void {
  runAction(action, file).catch((error) => console.error(`[action] ${action} failed`, error));
}

function refreshTray(settings: Settings): void {
  const template = trayTemplate(settings, dispatch, setCaptureDelay);
  const menu = updateTray(template);
  // Tests drive the same menu the tray shows.
  if (isTest) Menu.setApplicationMenu(menu);
}

app.on('second-instance', (_event, argv) => {
  for (const command of parseCli(argv)) dispatch(command.action, command.file);
});

// Stay in the tray when the last window closes.
app.on('window-all-closed', () => {});

app.on('will-quit', () => unregisterHotkeys());

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerIpc();
  const settings = await loadSettings();
  createTray();
  refreshTray(settings);
  registerHotkeys(settings.hotkeys, (action) => dispatch(action));
  onSettingsChanged((next, prev) => {
    refreshTray(next);
    if (next.general.launchAtLogin !== prev.general.launchAtLogin) {
      void import('./login-item').then((m) => m.applyLaunchAtLogin(next.general.launchAtLogin));
    }
    if (JSON.stringify(next.hotkeys) !== JSON.stringify(prev.hotkeys)) {
      registerHotkeys(next.hotkeys, (action) => dispatch(action));
    }
  });
  onAppState(() => refreshTray(getSettings()));
  if (isTest) (await import('./test-hooks')).installTestHooks(dispatch);
  for (const command of parseCli(process.argv)) dispatch(command.action, command.file);
});
