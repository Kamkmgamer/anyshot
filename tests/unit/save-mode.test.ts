import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../../src/shared/settings';
import { modeForShortcut, otherMode, shortcutFor } from '../../src/windows/editor/save-mode';

describe('save modes', () => {
  it('defaults to replacing the original and remembers a valid choice', () => {
    expect(DEFAULT_SETTINGS.editor.saveMode).toBe('replace');
    expect(parseSettings({ editor: { saveMode: 'copy' } }).editor.saveMode).toBe('copy');
    expect(parseSettings({ editor: { saveMode: 'merge' } }).editor.saveMode).toBe('replace');
  });

  it('gives Ctrl+S to the remembered choice and Ctrl+Alt+S to the other', () => {
    expect(shortcutFor('replace', 'replace')).toBe('Ctrl+S');
    expect(shortcutFor('copy', 'replace')).toBe('Ctrl+Alt+S');
    expect(shortcutFor('copy', 'copy')).toBe('Ctrl+S');
    expect(shortcutFor('replace', 'copy')).toBe('Ctrl+Alt+S');
    expect(modeForShortcut(false, 'copy')).toBe('copy');
    expect(modeForShortcut(true, 'copy')).toBe('replace');
    expect(modeForShortcut(true, 'replace')).toBe('copy');
    expect(otherMode('replace')).toBe('copy');
  });
});
