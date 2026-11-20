import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

vi.mock('electron', () => ({ Menu: {}, Tray: class {}, nativeImage: {} }));
vi.mock('../../src/main/paths', () => ({ paths: { resources: '/resources' } }));

const { trayTemplate } = await import('../../src/main/tray');

describe('tray menu', () => {
  it('has no Quick capture: capturing an area is already quick without instant preview', () => {
    const labels = trayTemplate(
      DEFAULT_SETTINGS,
      () => {},
      () => {},
    ).map((i) => i.label);
    expect(labels).not.toContain('Quick capture');
    expect(labels).toEqual(
      expect.arrayContaining([
        'Capture area',
        'Capture screen',
        'Capture last area',
        'Scroll capture',
      ]),
    );
  });
});
