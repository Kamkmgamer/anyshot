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
const LEFT_DOWN = 0x0002;
const LEFT_UP = 0x0004;
const NOTCH = 120;
const DONE = 'anyshot-e2e-done';

interface Helper {
  child: ChildProcessWithoutNullStreams;
  /** Commands sent and not yet answered, oldest first. */
  pending: { resolve: () => void; reject: (error: Error) => void }[];
  output: string;
}

let helper: Helper | null = null;

/** Ends a helper: its unanswered commands fail, and the next command starts a new one. */
function stopHelper(stopped: Helper, error: Error): void {
  if (helper === stopped) helper = null;
  for (const command of stopped.pending.splice(0)) command.reject(error);
}

function startHelper(): Helper {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-']);
  const started: Helper = { child, pending: [], output: '' };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    started.output += chunk;
    for (let at = started.output.indexOf(DONE); at >= 0; at = started.output.indexOf(DONE)) {
      started.output = started.output.slice(at + DONE.length);
      started.pending.shift()?.resolve();
    }
  });
  child.on('error', (error) =>
    stopHelper(started, new Error(`Pointer helper failed: ${error.message}`)),
  );
  child.on('exit', (code, signal) =>
    stopHelper(started, new Error(`Pointer helper exited (${signal ?? `code ${code}`})`)),
  );
  // Writing to a helper that has died fails here; the exit handler reports it.
  child.stdin.on('error', () => {});
  child.stdin.write(`${WIN32_INPUT}\n`);
  return started;
}

function powershell(command: string): Promise<void> {
  helper ??= startHelper();
  const current = helper;
  return new Promise((resolve, reject) => {
    current.pending.push({ resolve, reject });
    current.child.stdin.write(`${command}; '${DONE}'\n`);
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

/** Clicks the real left mouse button where the pointer is. */
export async function click(): Promise<void> {
  if (process.platform === 'win32') {
    const input = '[AnyshotE2E.Input]::mouse_event';
    await powershell(
      `${input}(${LEFT_DOWN}, 0, 0, 0, [UIntPtr]::Zero); ${input}(${LEFT_UP}, 0, 0, 0, [UIntPtr]::Zero)`,
    );
  } else {
    execFileSync('xdotool', ['click', '1']);
  }
}

/** Ends the helper process, if one was started. */
export function releasePointer(): void {
  if (!helper) return;
  const released = helper;
  stopHelper(released, new Error('Pointer helper released'));
  released.child.stdin.end();
  released.child.kill();
}
