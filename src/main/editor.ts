import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { app, type BrowserWindow, dialog, Notification, screen } from 'electron';
import { growToMinimum } from '../shared/geometry';
import type { EditorInit, EditorSource } from '../shared/ipc';
import { isProject, PROJECT_EXTENSION, unpackProject } from '../shared/project';
import { readPng } from './clipboard';
import { writeBytes } from './deliver';
import { type Frame, putFrame, releaseFrame } from './frames';
import { getRetainedEntry, readEditable, release, retain } from './history';
import { handle } from './ipc';
import { registerMediaRoute } from './protocol';
import { getSettings } from './settings-store';
import { createWindow } from './windows';

interface EditorState {
  init: EditorInit;
  dirty: boolean;
  /** The history entry this editor works on, retained so pruning keeps it while open. */
  held: string | null;
}

const editors = new Map<number, EditorState>();
/** Encoded images (opened files, clipboard, projects) served to editor windows. */
const sources = new Map<string, { bytes: Uint8Array; mime: string }>();

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

function servedSource(bytes: Uint8Array, mime: string): { source: EditorSource; token: string } {
  const token = randomUUID();
  sources.set(token, { bytes, mime });
  return { source: { kind: 'url', url: `/@editor-src/${token}` }, token };
}

/** `held` is an entry the caller already retained; the editor releases it on close. */
function open(
  init: Omit<EditorInit, 'settings'>,
  size: { width: number; height: number },
  cleanup: () => void,
  held: string | null = null,
) {
  const { workArea, scaleFactor } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  // Fit the image at its native size if possible, with room for the toolbars. The page
  // then reports what its toolbars need exactly (editor:min-size); 820 covers them as
  // they are, so the window rarely has to grow once shown.
  const width = Math.round(
    Math.min(workArea.width * 0.9, Math.max(820, size.width / scaleFactor + 80)),
  );
  const height = Math.round(
    Math.min(workArea.height * 0.9, Math.max(520, size.height / scaleFactor + 170)),
  );
  const win = createWindow('editor', {
    width,
    height,
    minWidth: 640,
    minHeight: 420,
    title: `${init.title} — anyshot`,
    backgroundColor: '#111113',
  });
  const id = win.webContents.id;
  editors.set(id, { init: { ...init, settings: getSettings() }, dirty: false, held });
  win.once('ready-to-show', () => win.show());
  win.on('close', (event) => confirmClose(win, event));
  win.once('closed', () => {
    const state = editors.get(id);
    editors.delete(id);
    cleanup();
    if (state?.held) release(state.held);
  });
  return win;
}

// Quitting closes editors without asking per window; a blocking prompt here would stall quit.
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});

function confirmClose(win: BrowserWindow, event: Electron.Event): void {
  const state = editors.get(win.webContents.id);
  if (quitting || !state?.dirty) return;
  const choice = dialog.showMessageBoxSync(win, {
    type: 'question',
    buttons: ['Discard changes', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Close without saving your edits?',
    detail:
      'Saving, copying or pinning keeps the edits editable in History; Save project (Ctrl+Shift+S) writes them to a file.',
  });
  if (choice === 1) event.preventDefault();
}

/** Opens the editor on raw pixels handed over from the overlay. */
export async function openEditorWithImage(image: Frame, doc: unknown): Promise<void> {
  const frameId = putFrame(image);
  open(
    {
      source: { kind: 'frame', frameId, width: image.width, height: image.height },
      doc,
      title: 'Capture',
      projectPath: null,
      historyId: null,
    },
    image,
    () => releaseFrame(frameId),
  );
}

export async function openHistoryEntry(id: string): Promise<void> {
  const entry = await getRetainedEntry(id);
  if (!entry) return;
  // Held while the editor is open: it loads the image and saves edits back to the entry.
  try {
    const title = new Date(entry.createdAt).toLocaleString();
    // Annotated entries reopen as their original pixels with editable annotations.
    const project = await readEditable(id);
    if (project) {
      const { source, token } = servedSource(project.bytes, project.image.mime);
      open(
        { source, doc: project.doc, title, projectPath: null, historyId: id },
        project.image,
        () => sources.delete(token),
        id,
      );
      return;
    }
    open(
      {
        source: { kind: 'url', url: `/@history/${id}/image` },
        doc: null,
        title,
        projectPath: null,
        historyId: id,
      },
      entry,
      () => {},
      id,
    );
  } catch (error) {
    release(id);
    throw error;
  }
}

/**
 * Moves an editor's hold to the entry its edits now go to (the first save of
 * a fresh capture, Save as copy). The new entry is retained before the old
 * one is released, so a shared entry is never dropped in between.
 */
export function holdEntry(win: BrowserWindow, id: string): void {
  if (win.isDestroyed()) return;
  const state = editors.get(win.webContents.id);
  if (!state || state.held === id) return;
  retain(id);
  if (state.held) release(state.held);
  state.held = id;
}

/** Opens an image or `.anyshot` project; asks for a file when none is given. */
export async function openImage(file?: string): Promise<boolean> {
  let path = file;
  if (!path) {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        {
          name: 'Images and projects',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', PROJECT_EXTENSION],
        },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return false;
    path = result.filePaths[0];
  }
  try {
    const bytes = new Uint8Array(await readFile(path));
    if (isProject(bytes)) {
      const project = unpackProject(bytes);
      const { source, token } = servedSource(project.bytes, project.image.mime);
      open(
        { source, doc: project.doc, title: basename(path), projectPath: path, historyId: null },
        project.image,
        () => sources.delete(token),
      );
      return true;
    }
    const mime = IMAGE_TYPES[extname(path).toLowerCase()];
    if (!mime) throw new Error('Unsupported file type');
    const { source, token } = servedSource(bytes, mime);
    open(
      { source, doc: null, title: basename(path), projectPath: null, historyId: null },
      { width: 1200, height: 800 },
      () => sources.delete(token),
    );
    return true;
  } catch (error) {
    new Notification({
      title: 'anyshot could not open the file',
      body: String((error as Error).message),
    }).show();
    return false;
  }
}

export async function openClipboard(): Promise<void> {
  const png = await readPng();
  if (!png) {
    new Notification({ title: 'anyshot', body: 'The clipboard has no image.' }).show();
    return;
  }
  const { source, token } = servedSource(png, 'image/png');
  open(
    { source, doc: null, title: 'Clipboard image', projectPath: null, historyId: null },
    { width: 1200, height: 800 },
    () => sources.delete(token),
  );
}

registerMediaRoute('editor-src', async (token) => {
  const entry = sources.get(token);
  return entry
    ? new Response(entry.bytes as Uint8Array<ArrayBuffer>, {
        headers: { 'content-type': entry.mime },
      })
    : null;
});

handle('editor:init', (_req, { win }) => {
  const state = editors.get(win.webContents.id);
  if (!state) throw new Error('Unknown editor');
  return state.init;
});

handle('editor:open', () => openImage());

handle('editor:min-size', ({ width, height }, { win }) => {
  if (![width, height].every((n) => Number.isFinite(n) && n > 0)) return;
  const { workArea } = screen.getDisplayMatching(win.getBounds());
  const bounds = win.getContentBounds();
  const grown = growToMinimum(bounds, { width, height }, workArea);
  // The window frame adds to the content size on Windows; keep the minimum about content.
  const frame = {
    width: win.getBounds().width - bounds.width,
    height: win.getBounds().height - bounds.height,
  };
  win.setMinimumSize(
    Math.min(Math.ceil(width), workArea.width) + frame.width,
    Math.min(Math.ceil(height), workArea.height) + frame.height,
  );
  if (grown.width !== bounds.width || grown.height !== bounds.height) win.setContentBounds(grown);
});

handle('editor:set-title', ({ title, dirty }, { win }) => {
  const state = editors.get(win.webContents.id);
  if (state) state.dirty = dirty;
  win.setTitle(`${dirty ? '• ' : ''}${title} — anyshot`);
});

handle('editor:save-project', async ({ bytes, saveAs }, { win }) => {
  const state = editors.get(win.webContents.id);
  if (!state) return null;
  let path = saveAs ? null : state.init.projectPath;
  if (!path) {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${state.init.title.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '-')}.${PROJECT_EXTENSION}`,
      filters: [{ name: 'anyshot project', extensions: [PROJECT_EXTENSION] }],
    });
    if (result.canceled || !result.filePath) return null;
    path = result.filePath;
  }
  await writeBytes(path, new Uint8Array(bytes));
  state.init = { ...state.init, projectPath: path, title: basename(path) };
  return path;
});
