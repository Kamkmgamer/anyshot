import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dialog } from 'electron';
import { EXTENSIONS, expandTemplate } from '../shared/filename';
import type { DeliverAction, DeliverRequest, DeliverResult, EncodedImage } from '../shared/ipc';
import type { Settings } from '../shared/settings';
import { copyPng, copyText } from './clipboard';
import { paths } from './paths';
import { getSettings } from './settings-store';

export interface Delivered {
  request: DeliverRequest;
  result: DeliverResult;
}

type AfterDeliver = (delivered: Delivered) => Promise<string | undefined> | string | undefined;
const afterHooks: AfterDeliver[] = [];

/** Lets later features (history, floating thumbnail) react to every finished capture. */
export function onDelivered(hook: AfterDeliver): void {
  afterHooks.push(hook);
}

export function saveDir(settings: Settings): string {
  return settings.output.saveDir || paths.defaultSaveDir;
}

/** Picks a non-existing path in the save folder from the filename template. */
export async function defaultSavePath(
  image: EncodedImage,
  settings = getSettings(),
): Promise<string> {
  const { existsSync } = await import('node:fs');
  const base = join(
    saveDir(settings),
    expandTemplate(settings.output.filenameTemplate, new Date()),
  );
  const ext = EXTENSIONS[image.mime];
  let candidate = `${base}.${ext}`;
  for (let i = 2; existsSync(candidate); i++) candidate = `${base} (${i}).${ext}`;
  return candidate;
}

export async function writeImage(path: string, image: EncodedImage): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, new Uint8Array(image.bytes));
}

async function askSavePath(image: EncodedImage): Promise<string | null> {
  const suggested = await defaultSavePath(image);
  const ext = EXTENSIONS[image.mime];
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: suggested,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  return canceled || !filePath ? null : filePath;
}

async function save(request: DeliverRequest, ask: boolean): Promise<DeliverResult> {
  const image = request.saveImage ?? request.image;
  const path = ask ? await askSavePath(image) : await defaultSavePath(image);
  if (!path) return { ok: false, error: 'cancelled' };
  await writeImage(path, image);
  if (getSettings().output.copyPathAfterSave) await copyText(path);
  return { ok: true, path };
}

/** Resolves the "quick" action (Enter) to concrete steps from settings. */
export function quickSteps(settings: Settings): DeliverAction[] {
  switch (settings.capture.quickAction) {
    case 'copy':
      return ['copy'];
    case 'save':
      return ['save'];
    case 'copy+save':
      return ['copy', 'save'];
    case 'save+copyPath':
      return ['save'];
    case 'none':
      return [];
  }
}

export async function deliver(request: DeliverRequest): Promise<DeliverResult> {
  const settings = getSettings();
  const png = new Uint8Array(request.image.bytes);
  const steps = request.action === 'quick' ? quickSteps(settings) : [request.action];
  let result: DeliverResult = { ok: true };
  for (const step of steps) {
    if (step === 'copy') await copyPng(png);
    else if (step === 'save' || step === 'saveAs') {
      const ask = step === 'saveAs' || settings.output.saveAction === 'ask';
      result = { ...result, ...(await save(request, ask)) };
      if (result.ok && result.path && settings.capture.quickAction === 'save+copyPath') {
        await copyText(result.path);
      }
      if (!result.ok) return result;
    }
  }
  for (const hook of afterHooks) {
    const historyId = await hook({ request, result });
    if (historyId) result.historyId = historyId;
  }
  return result;
}
