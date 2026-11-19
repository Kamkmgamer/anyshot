import { describe, expect, it } from 'vitest';
import { isProject, packProject, unpackProject } from '../../src/shared/project';

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
});
