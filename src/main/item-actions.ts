import { nativeImage, shell } from 'electron';
import type { DeliverResult, ItemAction } from '../shared/ipc';
import { copyPng } from './clipboard';
import { saveBytes } from './deliver';
import { getEntry, imagePath, readImage, removeEntry, thumbPath, updateEntry } from './history';
import { handle } from './ipc';

/** Actions on an existing history entry (floating preview, pins, history window). */
export async function runItemAction(
  historyId: string,
  action: ItemAction,
  sender?: Electron.WebContents,
): Promise<DeliverResult> {
  const entry = await getEntry(historyId);
  if (!entry) return { ok: false, error: 'This capture is no longer in history.' };
  switch (action) {
    case 'copy':
      await copyPng(await readImage(entry.id));
      return { ok: true };
    case 'save':
    case 'saveAs': {
      const result = await saveBytes(await readImage(entry.id), 'image/png', action === 'saveAs');
      if (result.ok && result.path) await updateEntry(entry.id, { savedPath: result.path });
      return result;
    }
    case 'pin':
      await (await import('./pins')).pinEntry(entry);
      return { ok: true };
    case 'edit':
      await (await import('./editor')).openHistoryEntry(entry.id);
      return { ok: true };
    case 'delete':
      await removeEntry(entry.id);
      return { ok: true };
    case 'reveal':
      shell.showItemInFolder(entry.savedPath ?? imagePath(entry.id));
      return { ok: true };
    case 'drag': {
      // Dragging the preview into another app drops the file.
      const icon = nativeImage.createFromPath(thumbPath(entry.id));
      sender?.startDrag({
        file: entry.savedPath ?? imagePath(entry.id),
        icon: icon.isEmpty()
          ? nativeImage.createFromPath(imagePath(entry.id)).resize({ width: 96 })
          : icon.resize({ width: 96 }),
      });
      return { ok: true };
    }
    case 'ocr':
      await (await import('./ocr')).recognizeEntry(entry.id);
      return { ok: true };
    case 'upload':
      return (await import('./uploads')).uploadEntry(entry.id);
  }
}

handle('item:action', ({ historyId, action }, { event }) =>
  runItemAction(historyId, action, event.sender),
);
