import { globalShortcut } from 'electron';
import { HOTKEY_ACTIONS, type HotkeyAction, type Settings } from '../shared/settings';

export interface HotkeyReport {
  registered: HotkeyAction[];
  failed: { action: HotkeyAction; accelerator: string }[];
}

let registered = new Map<string, HotkeyAction>();

/** Re-registers all global shortcuts from settings. Event-driven: no polling. */
export function registerHotkeys(
  hotkeys: Settings['hotkeys'],
  run: (action: HotkeyAction) => void,
): HotkeyReport {
  globalShortcut.unregisterAll();
  registered = new Map();
  const report: HotkeyReport = { registered: [], failed: [] };
  for (const action of HOTKEY_ACTIONS) {
    const accelerator = hotkeys[action];
    if (!accelerator || registered.has(accelerator)) continue;
    let ok = false;
    try {
      ok = globalShortcut.register(accelerator, () => run(action));
    } catch {
      ok = false;
    }
    if (ok) {
      registered.set(accelerator, action);
      report.registered.push(action);
    } else {
      report.failed.push({ action, accelerator });
    }
  }
  if (report.failed.length > 0) {
    console.warn('[hotkeys] could not register', report.failed);
  }
  return report;
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll();
  registered.clear();
}
