import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dialog, type Rectangle } from 'electron';
import { EXTENSIONS, expandTemplate } from '../shared/filename';
import type { DeliverAction, DeliverRequest, DeliverResult, EncodedImage } from '../shared/ipc';
import type { Settings } from '../shared/settings';
import { copyPng, copyText } from './clipboard';
import { addEntry, release, replaceImage } from './history';
import { paths } from './paths';
import { getSettings } from './settings-store';

export function saveDir(settings: Settings): string {
  return settings.output.saveDir || paths.defaultSaveDir;
}

/** Picks a non-existing path in the save folder from the filename template. */
export function defaultSavePath(mime: EncodedImage['mime'], settings = getSettings()): string {
  const base = join(
    saveDir(settings),
    expandTemplate(settings.output.filenameTemplate, new Date()),
  );
  const ext = EXTENSIONS[mime];
  let candidate = `${base}.${ext}`;
  for (let i = 2; existsSync(candidate); i++) candidate = `${base} (${i}).${ext}`;
  return candidate;
}

export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

export async function askSavePath(mime: EncodedImage['mime']): Promise<string | null> {
  const ext = EXTENSIONS[mime];
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: defaultSavePath(mime),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  return canceled || !filePath ? null : filePath;
}

/** Saves bytes either to the default folder or wherever the user picks. */
export async function saveBytes(
  bytes: Uint8Array,
  mime: EncodedImage['mime'],
  ask: boolean,
): Promise<DeliverResult> {
  const path = ask ? await askSavePath(mime) : defaultSavePath(mime);
  if (!path) return { ok: false, error: 'cancelled' };
  await writeBytes(path, bytes);
  const settings = getSettings();
  if (settings.output.copyPathAfterSave || settings.capture.quickAction === 'save+copyPath') {
    await copyText(path);
  }
  return { ok: true, path };
}

/** Resolves the "quick" action (Enter) to concrete steps from settings. */
export function quickSteps(settings: Settings): DeliverAction[] {
  switch (settings.capture.quickAction) {
    case 'copy':
      return ['copy'];
    case 'save':
    case 'save+copyPath':
      return ['save'];
    case 'copy+save':
      return ['copy', 'save'];
    case 'none':
      return [];
  }
}

/**
 * Finishes a capture: runs the requested action, records the image in
 * history and shows the follow-up UI (floating preview, pin, OCR, upload).
 */
export async function deliver(request: DeliverRequest): Promise<DeliverResult> {
  const settings = getSettings();
  const png = new Uint8Array(request.image.bytes);
  const steps = request.action === 'quick' ? quickSteps(settings) : [request.action];
  let result: DeliverResult = { ok: true };
  for (const step of steps) {
    if (step === 'copy') await copyPng(png);
    if (step === 'save' || step === 'saveAs') {
      const file = request.saveImage ?? request.image;
      const ask = step === 'saveAs' || settings.output.saveAction === 'ask';
      result = await saveBytes(new Uint8Array(file.bytes), file.mime, ask);
      if (!result.ok) return result;
    }
  }

  const image = {
    png,
    width: request.image.width,
    height: request.image.height,
    ...(request.thumb ? { thumb: request.thumb } : {}),
  };
  const existing = request.historyId ? await replaceImage(request.historyId, image) : undefined;
  if (existing) {
    result.historyId = existing.id;
    if (steps.includes('pin')) await (await import('./pins')).pinEntry(existing);
    return result;
  }
  const entry = await addEntry({ ...image, savedPath: result.path ?? null });
  result.historyId = entry.id;

  const followUp = steps.includes('pin')
    ? (await import('./pins')).pinEntry(entry, request.screenRect as Rectangle | undefined)
    : steps.includes('ocr')
      ? (await import('./ocr')).recognizeEntry(entry.id)
      : steps.includes('upload')
        ? (await import('./uploads')).uploadEntry(entry.id)
        : settings.capture.showThumbnail && request.action !== 'none' && !request.quiet
          ? (await import('./floating')).showFloating(entry)
          : undefined;
  await followUp;
  // The new entry was retained for its consumer; drop the hold now that one exists (or not).
  release(entry.id);
  if (settings.capture.openEditorAfterQuick && request.action === 'quick') {
    await (await import('./editor')).openHistoryEntry(entry.id);
  }
  return result;
}
