import { Notification, type UtilityProcess, utilityProcess } from 'electron';
import type { OcrResult } from '../shared/ipc';
import { copyText } from './clipboard';
import { readImage } from './history';
import { handle } from './ipc';
import { paths } from './paths';
import { getSettings } from './settings-store';
import { createWindow } from './windows';

// Tests shorten the idle period to check that the process really goes away.
const IDLE_MS = Number(process.env.ANYSHOT_OCR_IDLE_MS) || 30_000;

let child: UtilityProcess | null = null;
let idleTimer: NodeJS.Timeout | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (r: OcrResult) => void; reject: (e: Error) => void }>();
const results = new Map<number, OcrResult>();

/** The OCR process starts on first use and exits after 30 s without work. */
function ocrProcess(): UtilityProcess {
  if (child) return child;
  const proc = utilityProcess.fork(paths.utility('ocr'), [], { serviceName: 'anyshot OCR' });
  proc.on(
    'message',
    (message: { id: number; text?: string; confidence?: number; error?: string }) => {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error !== undefined) entry.reject(new Error(message.error));
      else entry.resolve({ text: message.text ?? '', confidence: message.confidence ?? 0, qr: [] });
      if (pending.size === 0) armIdle();
    },
  );
  proc.once('exit', () => {
    if (child === proc) child = null;
    for (const entry of pending.values()) entry.reject(new Error('The OCR process stopped'));
    pending.clear();
  });
  child = proc;
  return proc;
}

function armIdle(): void {
  clearTimeout(idleTimer);
  // One-shot timer while work is outstanding, never an interval.
  idleTimer = setTimeout(() => child?.kill(), IDLE_MS);
}

export function recognize(png: Uint8Array): Promise<OcrResult> {
  clearTimeout(idleTimer);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ocrProcess().postMessage({ id, png });
  });
}

export function isOcrRunning(): boolean {
  return child !== null;
}

/** Reads the text in a history entry, then copies it and/or shows it per settings. */
export async function recognizeEntry(historyId: string): Promise<void> {
  let result: OcrResult;
  try {
    result = await recognize(await readImage(historyId));
  } catch (error) {
    new Notification({
      title: 'Text recognition failed',
      body: String((error as Error).message),
    }).show();
    return;
  }
  const action = getSettings().capture.ocrAction;
  if (action !== 'window' && result.text) await copyText(result.text);
  if (action !== 'copy') showResult(result);
  else if (!result.text) new Notification({ title: 'anyshot', body: 'No text found.' }).show();
}

function showResult(result: OcrResult): void {
  const win = createWindow('ocr', {
    width: 520,
    height: 420,
    minWidth: 360,
    minHeight: 240,
    title: 'Recognised text',
  });
  const id = win.webContents.id;
  results.set(id, result);
  win.once('ready-to-show', () => win.show());
  win.once('closed', () => results.delete(id));
}

handle('ocr:init', (_req, { win }) => {
  const result = results.get(win.webContents.id);
  if (!result) throw new Error('No OCR result for this window');
  return result;
});
