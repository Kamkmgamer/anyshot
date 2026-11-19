import type { DeliverResult } from '../shared/ipc';

export async function uploadEntry(_historyId: string): Promise<DeliverResult> {
  return { ok: false, error: 'Uploads are not implemented yet' };
}
