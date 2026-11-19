import type { HotkeyAction } from '../shared/settings';

export type AppAction =
  | HotkeyAction
  | 'stopRecording'
  | 'settings'
  | 'openImage'
  | 'openClipboard'
  | 'quit';

export interface CliCommand {
  action: AppAction;
  file?: string;
}

const FLAGS: Record<string, AppAction> = {
  '--capture': 'captureArea',
  '--capture-screen': 'captureScreen',
  '--capture-ocr': 'captureOcr',
  '--quick-capture': 'quickCapture',
  '--capture-last': 'captureLastArea',
  '--scroll-capture': 'scrollCapture',
  '--record': 'recordArea',
  '--record-gif': 'recordGif',
  '--stop-recording': 'stopRecording',
  '--history': 'history',
  '--settings': 'settings',
  '--pin-clipboard': 'pinClipboard',
  '--open-clipboard': 'openClipboard',
};

/**
 * Turns command-line arguments into app actions. This is how Linux users bind
 * `anyshot --capture` in their desktop's keyboard settings when global
 * shortcuts aren't available (most Wayland sessions).
 */
export function parseCli(argv: readonly string[]): CliCommand[] {
  const commands: CliCommand[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const action = FLAGS[arg];
    if (action) commands.push({ action });
    else if (arg === '--open') {
      const file = argv[i + 1];
      if (file && !file.startsWith('--')) {
        commands.push({ action: 'openImage', file });
        i++;
      }
    } else if (arg.startsWith('--open=')) {
      commands.push({ action: 'openImage', file: arg.slice('--open='.length) });
    }
  }
  return commands;
}

export const CLI_FLAGS = Object.keys(FLAGS);
