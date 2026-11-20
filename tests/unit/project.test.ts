import { describe, expect, it } from 'vitest';
import { isProject, isProjectDoc, packProject, unpackProject } from '../../src/shared/project';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
const doc = { version: 1, annotations: [{ id: 'a', kind: 'text', text: 'héllo ✓' }] };

describe('project files', () => {
  it('round-trips the document and image bytes exactly', () => {
    const packed = packProject({
      doc,
      image: { mime: 'image/png', width: 3, height: 2 },
      bytes: png,
    });
    expect(isProject(packed)).toBe(true);
    const out = unpackProject(packed);
    expect(out.doc).toEqual(doc);
    expect(out.image).toEqual({ mime: 'image/png', width: 3, height: 2 });
    expect([...out.bytes]).toEqual([...png]);
  });

  it('works on a view into a larger buffer', () => {
    const packed = packProject({
      doc,
      image: { mime: 'image/png', width: 1, height: 1 },
      bytes: png,
    });
    const padded = new Uint8Array(packed.length + 10);
    padded.set(packed, 10);
    expect([...unpackProject(padded.subarray(10)).bytes]).toEqual([...png]);
  });

  it('rejects other files and truncated projects', () => {
    expect(isProject(png)).toBe(false);
    expect(() => unpackProject(png)).toThrow(/Not an anyshot project/);
    const packed = packProject({
      doc,
      image: { mime: 'image/png', width: 1, height: 1 },
      bytes: png,
    });
    expect(() => unpackProject(packed.subarray(0, 20))).toThrow(/truncated/);
  });

  it('checks the shape of stored documents', () => {
    const size = { width: 10, height: 8 };
    const ok = { version: 1, unit: 2, annotations: [], crop: null };
    expect(isProjectDoc(ok, size)).toBe(true);
    expect(isProjectDoc({ version: 1, annotations: [] }, size)).toBe(true);
    expect(isProjectDoc({ ...ok, crop: { x: 2, y: 2, width: 8, height: 6 } }, size)).toBe(true);
    for (const bad of [
      null,
      [],
      'doc',
      { ...ok, version: 2 },
      { ...ok, annotations: {} },
      { ...ok, unit: 0 },
      { ...ok, crop: { x: 2, y: 2, width: 9, height: 6 } },
      { ...ok, crop: { x: -1, y: 0, width: 5, height: 5 } },
      { ...ok, crop: { x: 0.5, y: 0, width: 5, height: 5 } },
      { ...ok, crop: { x: 0, y: 0, width: 0, height: 5 } },
      { ...ok, crop: 'all' },
    ]) {
      expect(isProjectDoc(bad, size)).toBe(false);
    }
  });
});
