import { describe, expect, it } from 'vitest';
import { mergeDeep } from '../../src/shared/schema';
import {
  ACCELERATOR,
  DEFAULT_SETTINGS,
  parseSettings,
  TOOL_IDS,
  toolsPageDefaults,
} from '../../src/shared/settings';

describe('settings schema', () => {
  it('returns defaults for missing or garbage input', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and replaces invalid ones field by field', () => {
    const parsed = parseSettings({
      capture: { quickAction: 'save', thumbnailDismissSeconds: 'soon', showThumbnail: false },
      output: { imageQuality: 500, imageFormat: 'bmp' },
      unknown: { x: 1 },
    });
    expect(parsed.capture.quickAction).toBe('save');
    expect(parsed.capture.showThumbnail).toBe(false);
    expect(parsed.capture.thumbnailDismissSeconds).toBe(5);
    expect(parsed.output.imageQuality).toBe(100);
    expect(parsed.output.imageFormat).toBe('png');
    expect(parsed).not.toHaveProperty('unknown');
  });

  it('validates accelerators', () => {
    for (const ok of ['Alt+Shift+X', 'CommandOrControl+Shift+4', 'F12', 'PrintScreen', '']) {
      expect(ACCELERATOR.test(ok), ok).toBe(true);
    }
    for (const bad of ['Alt+', 'Shift+Shift', 'Hyper+X', 'Alt+Shift+XY', 'rm -rf']) {
      expect(ACCELERATOR.test(bad), bad).toBe(false);
    }
    expect(parseSettings({ hotkeys: { captureArea: 'nonsense' } }).hotkeys.captureArea).toBe(
      DEFAULT_SETTINGS.hotkeys.captureArea,
    );
  });

  it('validates colours and lists', () => {
    const parsed = parseSettings({ tools: { color: 'red', presetColors: ['#000000', 'blue'] } });
    expect(parsed.tools.color).toBe(DEFAULT_SETTINGS.tools.color);
    expect(parsed.tools.presetColors).toEqual(['#000000', '#ff3b30']);
  });

  it('merges deep patches without dropping siblings', () => {
    const merged = parseSettings(mergeDeep(DEFAULT_SETTINGS, { capture: { delaySeconds: 3 } }));
    expect(merged.capture.delaySeconds).toBe(3);
    expect(merged.capture.quickAction).toBe(DEFAULT_SETTINGS.capture.quickAction);
    expect(merged.hotkeys).toEqual(DEFAULT_SETTINGS.hotkeys);
  });

  it('resets the Tools page without touching other choices', () => {
    const changed = parseSettings(
      mergeDeep(DEFAULT_SETTINGS, {
        tools: { enabledTools: ['select', 'arrow'], color: '#00ff00', strokeWidth: 9 },
        capture: { delaySeconds: 5 },
      }),
    );
    const reset = parseSettings(mergeDeep(changed, toolsPageDefaults()));
    expect(reset.tools.enabledTools).toEqual([...TOOL_IDS]);
    expect(reset.tools.enabledTools).toEqual(DEFAULT_SETTINGS.tools.enabledTools);
    expect(reset.tools.color).toBe('#00ff00');
    expect(reset.tools.strokeWidth).toBe(9);
    expect(reset.capture.delaySeconds).toBe(5);
    // A copy, so nothing that edits the patch can alter the defaults.
    expect(toolsPageDefaults().tools?.enabledTools).not.toBe(DEFAULT_SETTINGS.tools.enabledTools);
  });
});
