import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  session,
  type WebContents,
} from 'electron';
import { APP_ORIGIN, type EventChannel, type EventContract, type WindowKind } from '../shared/ipc';
import { paths } from './paths';
import { handleAppProtocol } from './protocol';

let sessionReady = false;
const sessionHooks: (() => void)[] = [];

/** Lets feature modules configure the session once it exists (e.g. media handlers). */
export function onSessionReady(hook: () => void): void {
  if (sessionReady) hook();
  else sessionHooks.push(hook);
}

/**
 * Touching the default session makes Chromium pre-spawn a spare renderer, so
 * it is configured lazily before the first window instead of at startup.
 */
function ensureSession(): void {
  if (sessionReady) return;
  sessionReady = true;
  handleAppProtocol();
  // Deny every permission by default; the recorder opts in for media.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  for (const hook of sessionHooks.splice(0)) hook();
}

interface Entry {
  kind: WindowKind;
  win: BrowserWindow;
}

const registry = new Map<number, Entry>();

export interface WindowOptions extends BrowserWindowConstructorOptions {
  /** Extra query string for the page URL. */
  query?: Record<string, string>;
}

/**
 * Creates a window with the app's secure defaults. Windows are created on
 * demand and destroyed on close; nothing is kept hidden "just in case".
 */
export function createWindow(kind: WindowKind, options: WindowOptions = {}): BrowserWindow {
  ensureSession();
  const { query, webPreferences, ...rest } = options;
  const win = new BrowserWindow({
    show: false,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    ...rest,
    webPreferences: {
      preload: paths.preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: true,
      v8CacheOptions: 'bypassHeatCheck',
      additionalArguments: [`--anyshot-kind=${kind}`],
      ...webPreferences,
    },
  });
  const id = win.webContents.id;
  registry.set(id, { kind, win });
  win.once('closed', () => registry.delete(id));
  hardenContents(win.webContents);
  const search = query ? `?${new URLSearchParams(query).toString()}` : '';
  void win.loadURL(`${APP_ORIGIN}/${kind}/index.html${search}`);
  return win;
}

function hardenContents(contents: WebContents) {
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

export function windowEntry(contentsId: number): Entry | undefined {
  return registry.get(contentsId);
}

export function windowsOf(kind: WindowKind): BrowserWindow[] {
  return [...registry.values()]
    .filter((e) => e.kind === kind && !e.win.isDestroyed())
    .map((e) => e.win);
}

export function allWindows(): Entry[] {
  return [...registry.values()];
}

export function send<K extends EventChannel>(
  win: BrowserWindow | null | undefined,
  channel: K,
  payload: EventContract[K],
): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

export function broadcast<K extends EventChannel>(channel: K, payload: EventContract[K]): void {
  for (const { win } of registry.values()) send(win, channel, payload);
}

/** Focuses an existing single-instance window of this kind, if any. */
export function focusExisting(kind: WindowKind): boolean {
  const [existing] = windowsOf(kind);
  if (!existing) return false;
  if (existing.isMinimized()) existing.restore();
  existing.show();
  existing.focus();
  return true;
}
