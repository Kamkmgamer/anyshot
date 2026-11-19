import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createWorker, OEM, type Worker } from 'tesseract.js';

// Runs in a utilityProcess forked on demand; main kills it after a short idle period.

interface OcrRequest {
  id: number;
  png: Uint8Array;
}

const resolveCjs = createRequire(import.meta.url).resolve;
// English data ships with the app (4.0.0 "best_int", ~3 MB gzipped), so OCR works offline.
const langPath = join(dirname(resolveCjs('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');

let worker: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  worker ??= createWorker('eng', OEM.LSTM_ONLY, { langPath, cacheMethod: 'none', gzip: true });
  return worker;
}

process.parentPort.on('message', async (event) => {
  const { id, png } = event.data as OcrRequest;
  try {
    const { data } = await (await getWorker()).recognize(Buffer.from(png));
    process.parentPort.postMessage({ id, text: data.text.trim(), confidence: data.confidence });
  } catch (error) {
    process.parentPort.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
