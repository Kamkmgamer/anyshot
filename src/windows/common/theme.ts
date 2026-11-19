import type { Settings } from '../../shared/settings';

let general: Settings['general'] | null = null;
let systemLight: MediaQueryList | null = null;

function paint(): void {
  if (!general) return;
  const root = document.documentElement;
  root.style.setProperty('--accent', general.accent);
  const theme = general.toolbarTheme;
  const light = theme === 'light' || (theme === 'system' && systemLight?.matches === true);
  // ui.css sets `color-scheme` from this class, so native controls follow too.
  root.classList.toggle('light', light);
}

/** Applies the theme and accent colour from settings; "system" follows OS changes live. */
export function applyTheme(settings: Settings): void {
  general = settings.general;
  if (!systemLight) {
    systemLight = window.matchMedia('(prefers-color-scheme: light)');
    systemLight.addEventListener('change', paint);
  }
  paint();
}

/** Applies the theme now and again whenever settings change while the window is open. */
export function followTheme(settings?: Settings): void {
  if (settings) applyTheme(settings);
  else void window.anyshot.invoke('settings:get').then(applyTheme);
  window.anyshot.on('settings:changed', applyTheme);
}
