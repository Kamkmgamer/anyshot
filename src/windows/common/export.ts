import type { Rect } from '../../shared/geometry';
import type { ExportDone, ExportFailed, ExportJob, ImageMime } from '../../workers/export-protocol';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (d: ExportDone) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../../workers/export.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = (event: MessageEvent<ExportDone | ExportFailed>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if ('error' in event.data) entry.reject(new Error(event.data.error));
    else entry.resolve(event.data);
  };
  return worker;
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
    getWorker().postMessage(job, [bitmap]);
  });
}

export function disposeExportWorker(): void {
  worker?.terminate();
  worker = null;
}
