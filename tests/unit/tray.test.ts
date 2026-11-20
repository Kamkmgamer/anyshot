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

describe('tray menu while recording', () => {
  const labels = () =>
    trayTemplate(
      DEFAULT_SETTINGS,
      () => {},
      () => {},
    ).map((i) => i.label);

  it('offers Stop and Pause, then Resume once paused', async () => {
    const { setAppState } = await import('../../src/main/app-state');
    expect(labels()).not.toContain('Stop recording');
    setAppState({ recording: true });
    expect(labels().slice(0, 2)).toEqual(['Stop recording', 'Pause recording']);
    setAppState({ recordingPaused: true });
    expect(labels().slice(0, 2)).toEqual(['Stop recording', 'Resume recording']);
    setAppState({ recording: false, recordingPaused: false });
    expect(labels()).not.toContain('Resume recording');
  });
});
