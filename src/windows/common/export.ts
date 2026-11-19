import type { Rect } from '../../shared/geometry';
import type { ExportDone, ExportFailed, ExportJob, ImageMime } from '../../workers/export-protocol';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (d: ExportDone) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('../../workers/export.worker.ts', import.meta.url), {
    type: 'module',
  });
  created.onmessage = (event: MessageEvent<ExportDone | ExportFailed>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if ('error' in event.data) entry.reject(new Error(event.data.error));
    else entry.resolve(event.data);
  };
  // A worker that fails to load (or crashes) answers nothing: fail what is pending
  // and start a fresh worker for the next export.
  created.onerror = (event) => {
    event.preventDefault();
    if (worker !== created) return;
    worker = null;
    created.terminate();
    const error = new Error(`Export worker failed: ${event.message || 'could not start'}`);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  worker = created;
  return created;
}

export interface ExportOptions {
  /** Full-resolution source and the region of it to export. */
  source: ImageBitmap;
  region: Rect;
  /** Annotation document already translated into region coordinates. */
  doc?: unknown;
  save?: { mime: ImageMime; quality: number };
  thumbMax?: number;
}

/** Crops, replays annotations and encodes in the export worker. */
export async function exportImage(options: ExportOptions): Promise<ExportDone> {
  const { x, y, width, height } = options.region;
  const bitmap = await createImageBitmap(options.source, x, y, width, height);
  const id = nextId++;
  const job: ExportJob = {
    id,
    bitmap,
    doc: options.doc ?? null,
    thumbMax: options.thumbMax ?? 480,
    ...(options.save ? { save: options.save } : {}),
  };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      getWorker().postMessage(job, [bitmap]);
    } catch (error) {
      pending.delete(id);
      bitmap.close();
      reject(error);
    }
  });
}
