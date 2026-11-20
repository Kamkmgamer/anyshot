/**
 * `.anyshot` project files: one file holding the editable annotation document
 * and the original image, without base64.
 *
 *   bytes 0..7   "ANYSHOT1"
 *   bytes 8..11  JSON length (uint32, little endian)
 *   then         UTF-8 JSON: { doc, image: { mime, width, height } }
 *   then         the image bytes (PNG)
 */
import type { Size } from './geometry';
import { isRecord } from './schema';

const MAGIC = 'ANYSHOT1';
const HEADER = MAGIC.length + 4;

export interface ProjectMeta {
  doc: unknown;
  image: { mime: string; width: number; height: number };
}

export interface Project extends ProjectMeta {
  bytes: Uint8Array;
}

export function packProject(project: Project): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify({ doc: project.doc, image: project.image }));
  const out = new Uint8Array(HEADER + json.length + project.bytes.length);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(MAGIC.length, json.length, true);
  out.set(json, HEADER);
  out.set(project.bytes, HEADER + json.length);
  return out;
}

export function isProject(bytes: Uint8Array): boolean {
  return (
    bytes.length >= HEADER && new TextDecoder().decode(bytes.subarray(0, MAGIC.length)) === MAGIC
  );
}

export function unpackProject(bytes: Uint8Array): Project {
  if (!isProject(bytes)) throw new Error('Not an anyshot project');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    MAGIC.length,
    true,
  );
  if (HEADER + length > bytes.length) throw new Error('Project file is truncated');
  const meta = JSON.parse(
    new TextDecoder().decode(bytes.subarray(HEADER, HEADER + length)),
  ) as Partial<ProjectMeta>;
  const image = meta.image;
  if (
    !image ||
    typeof image.mime !== 'string' ||
    typeof image.width !== 'number' ||
    typeof image.height !== 'number'
  ) {
    throw new Error('Project file has no image description');
  }
  return { doc: meta.doc ?? null, image, bytes: bytes.slice(HEADER + length) };
}

export const PROJECT_EXTENSION = 'anyshot';

const isInt = (v: unknown): v is number => Number.isInteger(v);

/**
 * Structural check of a stored annotation document before an editor gets it:
 * version, annotation list, scale and a crop that lies inside the image. The
 * editor still validates every annotation and drops malformed ones.
 */
export function isProjectDoc(doc: unknown, image: Size): boolean {
  if (!isRecord(doc) || doc.version !== 1 || !Array.isArray(doc.annotations)) return false;
  if (doc.unit !== undefined && !(typeof doc.unit === 'number' && doc.unit > 0)) return false;
  const crop = doc.crop;
  if (crop === null || crop === undefined) return true;
  if (!isRecord(crop)) return false;
  const { x, y, width, height } = crop;
  if (!isInt(x) || !isInt(y) || !isInt(width) || !isInt(height)) return false;
  return (
    x >= 0 &&
    y >= 0 &&
    width >= 1 &&
    height >= 1 &&
    x + width <= image.width &&
    y + height <= image.height
  );
}
