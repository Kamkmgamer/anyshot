import { dialog, Notification } from 'electron';
import type { DeliverResult } from '../shared/ipc';
import { copyText } from './clipboard';
import { readImage } from './history';
import { handle } from './ipc';
import { getSecret } from './secrets';
import { getSettings } from './settings-store';
import { httpProvider, s3Provider, type UploadProvider } from './upload-providers';

export async function currentProvider(): Promise<UploadProvider> {
  const { uploads } = getSettings();
  if (uploads.provider === 'http')
    return httpProvider(uploads.http, await getSecret('httpAuthorization'));
  if (uploads.provider === 's3') {
    const accessKeyId = await getSecret('s3AccessKeyId');
    const secretAccessKey = await getSecret('s3SecretAccessKey');
    if (!accessKeyId || !secretAccessKey) throw new Error('Add S3 keys in Settings ▸ Uploads.');
    return s3Provider(uploads.s3, { accessKeyId, secretAccessKey });
  }
  throw new Error('Choose an upload provider in Settings ▸ Uploads.');
}

export async function uploadEntry(historyId: string): Promise<DeliverResult> {
  if (getSettings().uploads.confirmBeforeUpload) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Upload', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: 'Upload this capture?',
      detail: 'Anyone with the link may be able to see it.',
    });
    if (response !== 0) return { ok: false, error: 'cancelled' };
  }
  try {
    const provider = await currentProvider();
    const url = await provider.upload({
      bytes: await readImage(historyId),
      name: `anyshot-${historyId.slice(0, 8)}.png`,
      mime: 'image/png',
    });
    await copyText(url);
    new Notification({ title: 'Uploaded', body: 'The link is on your clipboard.' }).show();
    return { ok: true, url };
  } catch (error) {
    const message = (error as Error).message;
    new Notification({ title: 'Upload failed', body: message }).show();
    return { ok: false, error: message };
  }
}

handle('uploads:test', async () => {
  try {
    const provider = await currentProvider();
    // A 1×1 transparent PNG.
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      ),
      (c) => c.charCodeAt(0),
    );
    const url = await provider.upload({
      bytes: png,
      name: `anyshot-test-${Date.now()}.png`,
      mime: 'image/png',
    });
    return { ok: true, url };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
});
