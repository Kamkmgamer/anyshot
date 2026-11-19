import { type FileHandle, open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { app, type BrowserWindow, type Display, Notification, shell } from 'electron';
import { expandTemplate } from '../shared/filename';
import { evenRect, type Rect, scaleRect } from '../shared/geometry';
import type { RecorderInit, RecorderStatus } from '../shared/ipc';
import { setAppState } from './app-state';
import { createUniqueFile } from './atomic-file';
import { copyText } from './clipboard';
import { setCaptureDisplay } from './display-media';
import { handle } from './ipc';
import { paths } from './paths';
import { registerMediaRoute } from './protocol';
import { getSettings } from './settings-store';
import { recordTiming } from './test-hooks';
import { createWindow, send } from './windows';

interface Recording {
  win: BrowserWindow;
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
export async function startRecording(display: Display, rect: Rect, gif: boolean): Promise<void> {
  if (active) return;
  const settings = getSettings();
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
    microphone: settings.recording.microphone && !gif,
    gif,
  };
  // Only the recorder keeps running while hidden; every other window throttles.
  const win = createWindow('recorder', {
    show: false,
    width: 360,
    height: 120,
    skipTaskbar: true,
    webPreferences: { backgroundThrottling: false },
  });
  setCaptureDisplay(win.webContents, display.id);
  active = {
    win,
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

async function cleanup(recording: Recording, error?: string): Promise<void> {
  if (active !== recording) return;
  active = null;
  setAppState({ recording: false });
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
  }
  recording.status = status;
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
