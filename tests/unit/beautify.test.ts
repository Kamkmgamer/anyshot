import { describe, expect, it } from 'vitest';
import { BACKGROUNDS, beautifyBackgroundCss } from '../../src/engine/beautify';
import { DEFAULT_EFFECTS } from '../../src/engine/model';

const b = (background: number) => ({ ...DEFAULT_EFFECTS.beautify, enabled: true, background });

describe('beautify preview background', () => {
  it('runs corner to corner like the exported canvas gradient', () => {
    // Square: straight to the bottom-right corner.
    expect(beautifyBackgroundCss(b(0), 100, 100)).toBe(
      `linear-gradient(135deg, ${BACKGROUNDS[0]?.[0]}, ${BACKGROUNDS[0]?.[1]})`,
    );
    // Wide frames tilt towards horizontal, tall ones towards vertical.
    const angle = (w: number, h: number) =>
      Number(/linear-gradient\(([\d.]+)deg/.exec(beautifyBackgroundCss(b(0), w, h))?.[1]);
    expect(angle(400, 100)).toBeCloseTo(180 - (Math.atan(4) * 180) / Math.PI, 2);
    expect(angle(100, 400)).toBeCloseTo(180 - (Math.atan(0.25) * 180) / Math.PI, 2);
  });

  it('uses the chosen background and wraps around the list', () => {
    expect(beautifyBackgroundCss(b(2), 10, 10)).toContain(BACKGROUNDS[2]?.[0]);
    expect(beautifyBackgroundCss(b(BACKGROUNDS.length + 1), 10, 10)).toContain(BACKGROUNDS[1]?.[1]);
  });
});
