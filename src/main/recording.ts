import { type FileHandle, open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, type Display, Notification, shell } from 'electron';
import { expandTemplate } from '../shared/filename';
import { evenRect, outsideFrame, placeBeside, type Rect, scaleRect } from '../shared/geometry';
import type { RecorderInit, RecorderStatus } from '../shared/ipc';
import { recordingAudio } from '../shared/recording-audio';
import { appState, setAppState } from './app-state';
import { createUniqueFile } from './atomic-file';
import { nudgeCapture } from './capture-nudge';
import { copyText } from './clipboard';
import { setCaptureDisplay } from './display-media';
import { handle } from './ipc';
import { paths } from './paths';
import { registerMediaRoute } from './protocol';
import { getSettings } from './settings-store';
import { SYSTEM_AUDIO_AVAILABLE } from './system-audio';
import { recordTiming } from './test-hooks';
import { createWindow, send } from './windows';

/** The recording controls: the recorder window itself, shown beside the area. */
const HUD = { width: 216, height: 44, gap: 10 };
const BORDER = { thickness: 2, color: '#ef4444' };

interface Recording {
  win: BrowserWindow;
  display: Display;
  /** The recorded area, absolute DIP. */
  area: Rect;
  /** Frames the area while it records (none when the controls are hidden). */
  border: BrowserWindow | null;
  init: RecorderInit;
  files: Map<string, FileHandle>;
  finalPath: string | null;
  /** The temporary video a GIF is made from. */
  intermediatePath: string | null;
  status: RecorderStatus;
}

let active: Recording | null = null;

export function isRecording(): boolean {
  return active !== null;
}

/** Starts recording a region (CSS px, relative to the display) in a hidden recorder window. */
export async function startRecording(
  display: Display,
  rect: Rect,
  gif: boolean,
  chosen?: unknown,
): Promise<void> {
  if (active) return;
  const settings = getSettings();
  const audio = recordingAudio(settings.recording, chosen, gif, SYSTEM_AUDIO_AVAILABLE);
  const physical = {
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor),
  };
  const init: RecorderInit = {
    displayId: display.id,
    displaySize: physical,
    crop: evenRect(scaleRect(rect, display.scaleFactor)),
    scaleFactor: display.scaleFactor,
    fps: gif ? Math.min(15, settings.recording.fps) : settings.recording.fps,
    microphone: audio.microphone,
    systemAudio: audio.systemAudio,
    gif,
  };
  const area = {
    x: display.bounds.x + rect.x,
    y: display.bounds.y + rect.y,
    width: rect.width,
    height: rect.height,
  };
  const position = placeBeside(area, HUD, HUD.gap, display.workArea) ?? insideBottom(area, display);
  // The recorder window owns the stream and the encoder, and doubles as the controls.
  // It keeps running while hidden or unfocused; every other window throttles.
  const win = createWindow('recorder', {
    ...position,
    width: HUD.width,
    height: HUD.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    // Clicking the controls must not take focus from the app being recorded.
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: { backgroundThrottling: false },
  });
  // Kept out of screen captures (Windows 10 2004+ and macOS), in case it overlaps the area.
  win.setContentProtection(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  setCaptureDisplay(win.webContents, display.id);
  active = {
    win,
    display,
    area,
    border: null,
    init,
    files: new Map(),
    finalPath: null,
    intermediatePath: null,
    status: { state: 'starting', elapsedMs: 0, bytes: 0 },
  };
  setAppState({ recording: true });
  const current = active;
  win.once('closed', () => void cleanup(current, 'The recorder stopped unexpectedly.'));
}

export async function stopRecording(): Promise<void> {
  if (active) send(active.win, 'recorder:command', 'stop');
}

/** Pauses a running recording, or resumes a paused one. */
export async function togglePauseRecording(): Promise<void> {
  if (!active) return;
  // The recorder decides which: it may hold a pause asked for before every track started.
  const { state } = active.status;
  if (state === 'paused' || state === 'recording') send(active.win, 'recorder:command', 'toggle');
}

/** When no side of the area has room for the controls, they go inside it, at the bottom. */
function insideBottom(area: Rect, display: Display): { x: number; y: number } {
  const { workArea } = display;
  const x = area.x + (area.width - HUD.width) / 2;
  const y = area.y + area.height - HUD.height - 24;
  return {
    x: Math.round(Math.min(workArea.x + workArea.width - HUD.width, Math.max(workArea.x, x))),
    y: Math.round(Math.min(workArea.y + workArea.height - HUD.height, Math.max(workArea.y, y))),
  };
}

/** A red line along the window's edge: just outside the area, never over it. */
const BORDER_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(
  '<!doctype html><style>html,body{margin:0;height:100%;background:transparent}' +
    `body{box-sizing:border-box;border:${BORDER.thickness}px solid ${BORDER.color}}</style>`,
)}`;

/**
 * Frames the area with one transparent, click-through window a little larger than it.
 * (Windows won't make windows a few pixels thin, so separate strips can't do it.) The
 * inside is fully transparent, so clicks, the wheel and the capture all see what's under
 * it. It gets no content protection: on Windows before 10 2004 that would record as a
 * black rectangle over the whole area.
 */
function showBorder(area: Rect, display: Display): BrowserWindow | null {
  const frame = outsideFrame(area, BORDER.thickness, display.bounds);
  if (!frame) return null;
  const border = new BrowserWindow({
    ...frame,
    title: 'anyshot recording border',
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { sandbox: true, javascript: false, contextIsolation: true },
  });
  border.setIgnoreMouseEvents(true);
  border.setAlwaysOnTop(true, 'screen-saver');
  border.webContents.on('will-navigate', (event) => event.preventDefault());
  border.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  border.once('ready-to-show', () => {
    if (!border.isDestroyed()) border.showInactive();
  });
  void border.loadURL(BORDER_PAGE);
  return border;
}

async function cleanup(recording: Recording, error?: string): Promise<void> {
  if (active !== recording) return;
  active = null;
  setAppState({ recording: false, recordingPaused: false });
  if (recording.border && !recording.border.isDestroyed()) recording.border.destroy();
  for (const handle of recording.files.values()) await handle.close().catch(() => {});
  if (recording.intermediatePath) {
    await rm(recording.intermediatePath, { force: true }).catch((failure) =>
      console.error('[recorder] failed to remove intermediate video', failure),
    );
  }
  if (!recording.win.isDestroyed()) recording.win.destroy();
  if (error) {
    new Notification({ title: 'Recording failed', body: error }).show();
    return;
  }
  const path = recording.finalPath;
  if (!path) return;
  const whenDone = getSettings().recording.whenDone;
  if (whenDone === 'reveal') shell.showItemInFolder(path);
  else if (whenDone === 'open') void shell.openPath(path);
  else await copyText(path);
}

function recordingBase(): string {
  const settings = getSettings();
  const dir = settings.recording.saveDir || paths.defaultRecordingDir;
  return join(dir, expandTemplate(settings.recording.filenameTemplate, new Date()));
}

function current(win: BrowserWindow): Recording {
  if (!active || active.win !== win) throw new Error('No active recording for this window');
  return active;
}

handle('recorder:init', (_req, { win }) => current(win).init);

handle('recorder:open-file', async ({ ext }, { win }) => {
  const recording = current(win);
  // A GIF is made from an intermediate MP4 kept in the temp folder.
  const intermediate = recording.init.gif && ext !== 'gif';
  const base = intermediate ? join(app.getPath('temp'), `anyshot-${Date.now()}`) : recordingBase();
  const { path, handle } = await createUniqueFile(base, ext);
  if (active !== recording) {
    try {
      await handle.close();
    } finally {
      await rm(path, { force: true });
    }
    throw new Error('The recording ended before its output file opened.');
  }
  recording.files.set(path, handle);
  if (intermediate) recording.intermediatePath = path;
  else recording.finalPath = path;
  return path;
});

/** Encoded chunks are written as they arrive; a recording is never held in memory. */
handle('recorder:write', async ({ path, data, position }, { win }) => {
  const file = current(win).files.get(path);
  if (!file) throw new Error('File not open');
  await file.write(data, 0, data.byteLength, position);
});

handle('recorder:close-file', async ({ path }, { win }) => {
  const recording = current(win);
  const file = recording.files.get(path);
  await file?.close();
  recording.files.delete(path);
});

handle('recorder:status', (status, { win }) => {
  const recording = current(win);
  if (recording.status.state === 'starting' && status.state === 'recording') {
    recordTiming('recordingStarted', status.elapsedMs);
    // Capture has started: make sure Windows sends a first frame of a still screen.
    nudgeCapture(recording.display.bounds);
    if (getSettings().recording.showControls) {
      recording.win.showInactive();
      recording.border = showBorder(recording.area, recording.display);
    }
  }
  recording.status = status;
  const paused = status.state === 'paused';
  if (paused !== appState.recordingPaused) setAppState({ recordingPaused: paused });
});

handle('recorder:finish', async ({ ok, error }, { win }) => {
  const recording = current(win);
  await cleanup(recording, ok ? undefined : (error ?? 'Unknown error'));
});

handle('recorder:control', (command, { win }) =>
  send(current(win).win, 'recorder:command', command),
);

/**
 * Serves the intermediate video of an active GIF recording back to the
 * recorder with HTTP range support, so conversion reads it in pieces.
 */
registerMediaRoute('recording', async (rest, request) => {
  const path = decodeURIComponent(rest);
  if (!active?.intermediatePath || path !== active.intermediatePath) return null;
  const size = (await stat(path)).size;
  const match = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '');
  const start = match?.[1] ? Number(match[1]) : 0;
  const end = Math.min(size - 1, match?.[2] ? Number(match[2]) : size - 1);
  const body = new Uint8Array(Math.max(0, end - start + 1));
  const handle = await open(path, 'r');
  try {
    await handle.read(body, 0, body.length, start);
  } finally {
    await handle.close();
  }
  return new Response(body, {
    status: match ? 206 : 200,
    headers: {
      'content-type': 'application/octet-stream',
      'accept-ranges': 'bytes',
      'content-length': String(body.length),
      ...(match ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
    },
  });
});
