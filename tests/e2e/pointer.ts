import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from 'node:child_process';

// Real OS pointer input, in physical screen pixels: screen captures draw the real pointer,
// and real wheel input scrolls smoothly. Linux (X11) uses xdotool; Windows uses user32
// through one PowerShell process kept open for the run (starting one per call is too slow).

const WIN32_INPUT = [
  "Add-Type -Namespace AnyshotE2E -Name Input -MemberDefinition '",
  '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();',
  '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
  '[DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, System.UIntPtr extra);',
  "'; [void][AnyshotE2E.Input]::SetProcessDPIAware()",
].join(' ');
const WHEEL = 0x0800;
const NOTCH = 120;
const DONE = 'anyshot-e2e-done';

let shell: ChildProcessWithoutNullStreams | null = null;
let output = '';
const pending: (() => void)[] = [];

function powershell(command: string): Promise<void> {
  if (!shell) {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-']);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      for (let at = output.indexOf(DONE); at >= 0; at = output.indexOf(DONE)) {
        output = output.slice(at + DONE.length);
        pending.shift()?.();
      }
    });
    child.stdin.write(`${WIN32_INPUT}\n`);
    shell = child;
  }
  const child = shell;
  return new Promise((resolve) => {
    pending.push(resolve);
    child.stdin.write(`${command}; '${DONE}'\n`);
  });
}

/** Moves the real pointer to (x, y) in physical screen pixels. */
export async function movePointer(x: number, y: number): Promise<void> {
  const [px, py] = [Math.round(x), Math.round(y)];
  if (process.platform === 'win32') {
    await powershell(`[void][AnyshotE2E.Input]::SetCursorPos(${px}, ${py})`);
  } else {
    execFileSync('xdotool', ['mousemove', String(px), String(py)]);
  }
}

/** Turns the real mouse wheel one notch under the pointer. */
export async function wheel(direction: 'up' | 'down'): Promise<void> {
  if (process.platform === 'win32') {
    const delta = direction === 'down' ? -NOTCH : NOTCH;
    await powershell(`[AnyshotE2E.Input]::mouse_event(${WHEEL}, 0, 0, ${delta}, [UIntPtr]::Zero)`);
  } else {
    execFileSync('xdotool', ['click', direction === 'down' ? '5' : '4']);
  }
}

/** Ends the helper process, if one was started. */
export function releasePointer(): void {
  shell?.stdin.end();
  shell?.kill();
  shell = null;
  output = '';
  pending.length = 0;
}
