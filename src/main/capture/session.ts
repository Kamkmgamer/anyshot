import { type BrowserWindow, type Display, screen } from 'electron';
import type { Rect } from '../../shared/geometry';
import type { CaptureMode, OverlayInit } from '../../shared/ipc';
import { appState } from '../app-state';
import { putFrame, releaseFrame } from '../frames';
import { handle } from '../ipc';
import { getSettings } from '../settings-store';
import { recordTiming } from '../test-hooks';
import { createWindow, send } from '../windows';
import { grabDisplay } from './grab';

interface OverlayState {
  win: BrowserWindow;
  display: Display;
  init: Promise<OverlayInit>;
  frameId: string | null;
}

interface Session {
  mode: CaptureMode;
  startedAt: number;
  overlays: Map<number, OverlayState>;
  shown: boolean;
}

let session: Session | null = null;
let lastArea: { displayId: number; rect: Rect } | null = null;

const isLinux = process.platform === 'linux';

export function isCapturing(): boolean {
  return session !== null;
}

/** Starts a capture: freezes every display and shows one overlay per display. */
export async function startCapture(mode: CaptureMode): Promise<void> {
  if (session) {
    focusFirstOverlay();
    return;
  }
  const delay = appState.delaySeconds;
  if (delay > 0 && mode !== 'last') await new Promise((r) => setTimeout(r, delay * 1000));

  const startedAt = performance.now();
  const current: Session = { mode, startedAt, overlays: new Map(), shown: false };
  session = current;

  // The display under the pointer goes first so its overlay appears soonest.
  const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const displays = [cursor, ...screen.getAllDisplays().filter((d) => d.id !== cursor.id)];
  const single = mode === 'record' || mode === 'gif' || mode === 'scroll';
  for (const display of single ? [cursor] : displays) {
    // Grab before creating the window so a new window can never be in the shot.
    const grab = grabDisplay(display);
    const win = createOverlayWindow(display);
    const state: OverlayState = {
      win,
      display,
      frameId: null,
      init: grab.then((frame) => {
        const frameId = putFrame(frame);
        state.frameId = frameId;
        return buildInit(mode, display, frameId, frame);
      }),
    };
    const contentsId = win.webContents.id;
    current.overlays.set(contentsId, state);
    win.once('closed', () => {
      if (state.frameId) releaseFrame(state.frameId);
      current.overlays.delete(contentsId);
      if (current.overlays.size === 0 && session === current) session = null;
    });
    // Wait for this grab before grabbing the next display, so overlays never land in other grabs.
    await grab.catch(() => undefined);
    if (session !== current) return;
  }
}

function buildInit(
  mode: CaptureMode,
  display: Display,
  frameId: string,
  frame: { width: number; height: number },
): OverlayInit {
  const last = lastArea && lastArea.displayId === display.id ? lastArea.rect : null;
  return {
    mode,
    frameId,
    frame: { width: frame.width, height: frame.height },
    scaleFactor: frame.width / display.bounds.width,
    bounds: display.bounds,
    lastSelection: last,
    selectAll: mode === 'screen',
    settings: getSettings(),
    warm: false,
  };
}

function createOverlayWindow(display: Display): BrowserWindow {
  const { x, y, width, height } = display.bounds;
  const win = createWindow('overlay', {
    x,
    y,
    width,
    height,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: true,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    alwaysOnTop: true,
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setBounds(display.bounds);
  return win;
}

function stateOf(win: BrowserWindow): OverlayState {
  const state = session?.overlays.get(win.webContents.id);
  if (!state) throw new Error('No capture session for this overlay');
  return state;
}

function focusFirstOverlay(): void {
  const first = session?.overlays.values().next().value;
  first?.win.focus();
}

/** Closes every overlay (destroying its renderer) and ends the session. */
export function endCapture(): void {
  const current = session;
  if (!current) return;
  session = null;
  for (const { win, frameId } of current.overlays.values()) {
    if (frameId) releaseFrame(frameId);
    if (!win.isDestroyed()) win.destroy();
  }
  current.overlays.clear();
}

/** Hides overlays immediately (e.g. while an image is being encoded) without destroying them. */
export function hideOverlays(): void {
  for (const { win } of session?.overlays.values() ?? []) if (!win.isDestroyed()) win.hide();
}

export function overlayDisplay(win: BrowserWindow): Display | undefined {
  return session?.overlays.get(win.webContents.id)?.display;
}

handle('overlay:init', (_req, { win }) => stateOf(win).init);

handle('overlay:painted', (_req, { win }) => {
  if (!session) return;
  if (!session.shown) {
    session.shown = true;
    recordTiming('hotkeyToOverlay', performance.now() - session.startedAt);
  }
  // X11 window managers keep panels above plain always-on-top windows; full
  // screen covers them. Set only now: a full-screen window is shown at once.
  if (isLinux) win.setFullScreen(true);
  win.show();
  // The display under the pointer keeps focus so keyboard shortcuts work at once.
  const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  if (stateOf(win).display.id === cursor.id) win.focus();
});

handle('overlay:selection-start', (_req, { win }) => {
  for (const { win: other } of session?.overlays.values() ?? []) {
    if (other !== win) send(other, 'overlay:clear-selection', undefined);
  }
});

handle('overlay:cancel', () => endCapture());
handle('overlay:hide', () => hideOverlays());

handle('capture:remember-area', ({ rect }, { win }) => {
  const display = overlayDisplay(win);
  if (display) lastArea = { displayId: display.id, rect };
});

handle('capture:deliver', async (request, { kind }) => {
  // The overlay has already encoded everything it needs; close it right away.
  if (kind === 'overlay') endCapture();
  const { deliver } = await import('../deliver');
  return deliver(request);
});

handle('capture:to-editor', async ({ image, doc }) => {
  endCapture();
  const { openEditorWithImage } = await import('../editor');
  await openEditorWithImage(
    { rgba: new Uint8Array(image.rgba), width: image.width, height: image.height },
    doc,
  );
});

handle('capture:record', async (request, { win }) => {
  const display = overlayDisplay(win);
  endCapture();
  if (!display) return;
  const { startRecording } = await import('../recording');
  await startRecording(display, request.rect, request.gif);
});

handle('capture:scroll', async (request, { win }) => {
  const display = overlayDisplay(win);
  endCapture();
  if (!display) return;
  const { startScrollCapture } = await import('../scroll');
  await startScrollCapture(display, request.rect);
});
