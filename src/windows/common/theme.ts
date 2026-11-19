import type { Settings } from '../../shared/settings';

/** Applies the toolbar theme and accent colour from settings. */
export function applyTheme(settings: Settings): void {
  const root = document.documentElement;
  root.style.setProperty('--accent', settings.general.accent);
  const theme = settings.general.toolbarTheme;
  const light =
    theme === 'light' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  root.classList.toggle('light', light);
}
