import { resolve } from 'node:path';
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
export function parseCli(argv: readonly string[], workingDirectory?: string): CliCommand[] {
  const commands: CliCommand[] = [];
  const openFile = (file: string): CliCommand => ({
    action: 'openImage',
    file: file && workingDirectory ? resolve(workingDirectory, file) : file,
  });
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const action = FLAGS[arg];
    if (action) commands.push({ action });
    else if (arg === '--open') {
      const file = argv[i + 1];
      if (file && !file.startsWith('--')) {
        commands.push(openFile(file));
        i++;
      }
    } else if (arg.startsWith('--open=')) {
      commands.push(openFile(arg.slice('--open='.length)));
    }
  }
  return commands;
}

export const CLI_FLAGS = Object.keys(FLAGS);
