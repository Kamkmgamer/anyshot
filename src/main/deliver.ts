import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { dialog, type Rectangle } from 'electron';
import { EXTENSIONS, expandTemplate } from '../shared/filename';
import type { DeliverAction, DeliverRequest, DeliverResult, EncodedImage } from '../shared/ipc';
import type { Settings } from '../shared/settings';
import { createUniqueFile, writeFileAtomic } from './atomic-file';
import { copyPng, copyText } from './clipboard';
import { addEntry, checkEditable, release, replaceImage } from './history';
import { paths } from './paths';
import { getSettings } from './settings-store';

export function saveDir(settings: Settings): string {
  return settings.output.saveDir || paths.defaultSaveDir;
}

function templatePath(settings: Settings): string {
  return join(saveDir(settings), expandTemplate(settings.output.filenameTemplate, new Date()));
}

/** Suggests a non-existing path in the save folder from the filename template. */
export function defaultSavePath(mime: EncodedImage['mime'], settings = getSettings()): string {
  const base = templatePath(settings);
  const ext = EXTENSIONS[mime];
  let candidate = `${base}.${ext}`;
  for (let i = 2; existsSync(candidate); i++) candidate = `${base} (${i}).${ext}`;
  return candidate;
}

/** Writes through a temporary file, so a failed overwrite keeps the previous file. */
export function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  return writeFileAtomic(path, bytes);
}

/** Saves to a new file named from the template; never overwrites, even when saves race. */
async function saveToNewFile(bytes: Uint8Array, mime: EncodedImage['mime']): Promise<string> {
  const { path, handle } = await createUniqueFile(templatePath(getSettings()), EXTENSIONS[mime]);
  try {
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
  } catch (error) {
    await rm(path, { force: true }).catch(() => undefined);
    throw error;
  }
  return path;
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
  let path: string;
  if (ask) {
    const chosen = await askSavePath(mime);
    if (!chosen) return { ok: false, error: 'cancelled' };
    // The user confirmed this name in the dialog, including any overwrite.
    await writeBytes(chosen, bytes);
    path = chosen;
  } else {
    path = await saveToNewFile(bytes, mime);
  }
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
 * `onEntry` gets the resulting entry id while this delivery still holds it,
 * so a caller (an editor) can take its own hold first.
 */
export async function deliver(
  request: DeliverRequest,
  onEntry?: (id: string) => void,
): Promise<DeliverResult> {
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

  const edit = checkEditable(request.edit);
  const image = {
    png,
    width: request.image.width,
    height: request.image.height,
    ...(request.thumb ? { thumb: request.thumb } : {}),
    ...(edit ? { edit } : {}),
  };
  const existing = request.historyId
    ? await replaceImage(request.historyId, {
        ...image,
        ...(result.path ? { savedPath: result.path } : {}),
      })
    : undefined;
  if (existing) {
    result.historyId = existing.id;
    onEntry?.(existing.id);
    if (steps.includes('pin')) await (await import('./pins')).pinEntry(existing.id);
    return result;
  }
  const entry = await addEntry({ ...image, savedPath: result.path ?? null });
  result.historyId = entry.id;

  try {
    onEntry?.(entry.id);
    const followUp = steps.includes('pin')
      ? (await import('./pins')).pinEntry(entry.id, request.screenRect as Rectangle | undefined)
      : steps.includes('ocr')
        ? (await import('./ocr')).recognizeEntry(entry.id)
        : steps.includes('upload')
          ? (await import('./uploads')).uploadEntry(entry.id)
          : settings.capture.showThumbnail && request.action !== 'none' && !request.quiet
            ? (await import('./floating')).showFloating(entry)
            : undefined;
    await followUp;
    // The editor takes its own hold, so open it before this delivery's hold goes.
    if (settings.capture.openEditorAfterQuick && request.action === 'quick') {
      await (await import('./editor')).openHistoryEntry(entry.id);
    }
  } finally {
    release(entry.id);
  }
  return result;
}
