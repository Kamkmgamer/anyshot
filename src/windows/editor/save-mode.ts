import type { Settings } from '../../shared/settings';

/**
 * Saving an edited capture that already has a history entry either replaces
 * that entry or adds a copy. Ctrl+S runs the remembered choice and
 * Ctrl+Alt+S the other one (Ctrl+Shift+S is Save project).
 */
export type SaveMode = Settings['editor']['saveMode'];

export const SAVE_MODES: readonly SaveMode[] = ['replace', 'copy'];

export const SAVE_MODE_LABELS: Record<SaveMode, string> = {
  replace: 'Replace original',
  copy: 'Save as copy',
};

export const otherMode = (mode: SaveMode): SaveMode => (mode === 'replace' ? 'copy' : 'replace');

export function shortcutFor(mode: SaveMode, primary: SaveMode): string {
  return mode === primary ? 'Ctrl+S' : 'Ctrl+Alt+S';
}

export function modeForShortcut(alt: boolean, primary: SaveMode): SaveMode {
  return alt ? otherMode(primary) : primary;
}
