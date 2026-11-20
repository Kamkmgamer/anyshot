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
import { SYSTEM_AUDIO_AVAILABLE } from '../system-audio';

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
  /** Overlays are hidden while the result is encoded; the session ends soon. */
  finishing: boolean;
  ended: Promise<void>;
  end: () => void;
}

let session: Session | null = null;
let delaying = false;
let lastArea: { displayId: number; rect: Rect } | null = null;

const isLinux = process.platform === 'linux';

export function isCapturing(): boolean {
  return session !== null;
}

/** Starts a capture: freezes every display and shows one overlay per display. */
export async function startCapture(mode: CaptureMode): Promise<void> {
  if (session?.finishing) {
    // A hotkey pressed while the previous capture is still being delivered starts a new one after it.
    await session.ended;
  }
  if (session) {
    focusFirstOverlay();
    return;
  }
  const delay = appState.delaySeconds;
  if (delaying) return;
  if (delay > 0 && mode !== 'last') {
    delaying = true;
    await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    delaying = false;
    if (session) return;
  }

  const startedAt = performance.now();
  let end = () => {};
  const ended = new Promise<void>((resolve) => {
    end = resolve;
  });
  const current: Session = {
    mode,
    startedAt,
    overlays: new Map(),
    shown: false,
    finishing: false,
    ended,
    end,
  };
  session = current;

  // The display under the pointer goes first so its overlay appears soonest.
  const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const displays = [cursor, ...screen.getAllDisplays().filter((d) => d.id !== cursor.id)];
  const single = mode === 'record' || mode === 'gif' || mode === 'scroll';
  for (const display of single ? [cursor] : displays) {
    // Grab before creating the window so a new window can never be in the shot.
    const grab = grabDisplay(display);
    // Instant capture: the pre-loaded overlay serves the display under the pointer.
    const reused = display.id === cursor.id ? takeWarm(display) : null;
    const win = reused?.win ?? createOverlayWindow(display);
    const state: OverlayState = {
      win,
      display,
      frameId: null,
      init: grab.then((frame) => {
        if (session !== current || win.isDestroyed()) throw new Error('Capture ended');
        const frameId = putFrame(frame);
        state.frameId = frameId;
        return buildInit(mode, display, frameId, frame, display.id === cursor.id);
      }),
    };
    // The renderer may close before it asks for the grab result.
    void state.init.catch(() => undefined);
    reused?.claim(state.init);
    const contentsId = win.webContents.id;
    current.overlays.set(contentsId, state);
    win.once('closed', () => {
      if (state.frameId) releaseFrame(state.frameId);
      current.overlays.delete(contentsId);
      if (current.overlays.size === 0 && session === current) {
        session = null;
        current.end();
        schedulePrewarm();
      }
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
  underCursor: boolean,
): OverlayInit {
  const settings = getSettings();
  const last = lastArea && lastArea.displayId === display.id ? lastArea.rect : null;
  return {
    mode,
    frameId,
    frame: { width: frame.width, height: frame.height },
    scaleFactor: frame.width / display.bounds.width,
    bounds: display.bounds,
    lastSelection: last,
    // Without instant preview the full screen is captured at once: only the display under the pointer.
    selectAll: mode === 'screen' && (settings.capture.instantPreview || underCursor),
    settings,
    systemAudio: SYSTEM_AUDIO_AVAILABLE,
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
export function endCapture(owner?: BrowserWindow): void {
  const current = session;
  if (!current || (owner && ![...current.overlays.values()].some(({ win }) => win === owner))) {
    return;
  }
  session = null;
  current.end();
  for (const { win, frameId } of current.overlays.values()) {
    if (frameId) releaseFrame(frameId);
    if (!win.isDestroyed()) win.destroy();
  }
  current.overlays.clear();
  schedulePrewarm();
}

// ---------------------------------------------------------------- instant capture

interface Warm {
  win: BrowserWindow;
  /** The warm overlay's pending `overlay:init`; resolved when a capture claims it. */
  init: Promise<OverlayInit>;
  claim(init: Promise<OverlayInit>): void;
}

let warm: Warm | null = null;

/**
 * Instant capture keeps one hidden overlay loaded. Its renderer has already
 * started and asked for its init, which stays pending until a capture claims it.
 * Costs one renderer of memory and no CPU while hidden.
 */
export function prewarm(): void {
  if (!getSettings().capture.instantCapture || warm || session) return;
  const win = createOverlayWindow(screen.getPrimaryDisplay());
  let claim: (init: Promise<OverlayInit>) => void = () => {};
  const init = new Promise<OverlayInit>((resolve, reject) => {
    claim = (p) => p.then(resolve, reject);
  });
  void init.catch(() => undefined);
  const entry: Warm = { win, init, claim };
  warm = entry;
  win.once('closed', () => {
    if (warm === entry) warm = null;
  });
}

function takeWarm(display: Display): Warm | null {
  const w = warm;
  if (!w || w.win.isDestroyed()) return null;
  warm = null;
  w.win.setBounds(display.bounds);
  return w;
}

export function dropWarm(): void {
  const w = warm;
  warm = null;
  if (w && !w.win.isDestroyed()) w.win.destroy();
}

function schedulePrewarm(): void {
  // Let the finished capture's windows go first, then load the next overlay in the background.
  setTimeout(prewarm, 300);
}

/** Hides overlays immediately (e.g. while an image is being encoded) without destroying them. */
export function hideOverlays(): void {
  if (session) session.finishing = true;
  for (const { win } of session?.overlays.values() ?? []) if (!win.isDestroyed()) win.hide();
}

export function overlayDisplay(win: BrowserWindow): Display | undefined {
  return session?.overlays.get(win.webContents.id)?.display;
}

handle('overlay:init', (_req, { win }) => (warm?.win === win ? warm.init : stateOf(win).init));

handle('overlay:painted', (_req, { win }) => {
  const state = session?.overlays.get(win.webContents.id);
  if (!session || session.finishing || !state) return;
  if (!session.shown) {
    session.shown = true;
    recordTiming('hotkeyToOverlay', performance.now() - session.startedAt);
  }
  // X11 window managers keep panels above plain always-on-top windows.
  if (isLinux) win.setFullScreen(true);
  win.show();
  const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  if (state.display.id === cursor.id) win.focus();
});

handle('overlay:selection-start', (_req, { win }) => {
  for (const { win: other } of session?.overlays.values() ?? []) {
    if (other !== win) send(other, 'overlay:clear-selection', undefined);
  }
});

handle('overlay:cancel', (_req, { win }) => endCapture(win));
handle('overlay:hide', (_req, { win }) => {
  if (overlayDisplay(win)) hideOverlays();
});

handle('capture:remember-area', ({ rect }, { win }) => {
  const display = overlayDisplay(win);
  if (display) lastArea = { displayId: display.id, rect };
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
  await startRecording(display, request.rect, request.gif, request.audio);
});

handle('capture:scroll', async (request, { win }) => {
  const display = overlayDisplay(win);
  endCapture();
  if (!display) return;
  const { startScrollCapture } = await import('../scroll');
  await startScrollCapture(display, request.rect);
});
