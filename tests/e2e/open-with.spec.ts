import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { type Launched, launch, pageOf, verifyAndClose } from './harness';

/** The Electron binary: outside Electron, the package exports its path. */
const electronPath = String(createRequire(join(process.cwd(), 'package.json'))('electron'));

// A 3 × 2 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEElEQVR4nGP4z8AAQQxwFgBB0gX7h/C5SAAAAABJRU5ErkJggg==',
  'base64',
);

let ctx: Launched | undefined;
let dir: string;

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'anyshot-open-with-'));
});

test.afterEach(async () => {
  if (ctx) await verifyAndClose(ctx);
  ctx = undefined;
  await rm(dir, { recursive: true, force: true });
});

// "Open with" starts anyshot with the file as a bare argument: a path on Windows,
// a file:// URL from a Linux desktop entry (Exec=anyshot %U).
for (const form of ['path', 'file URL'] as const) {
  test(`a bare image ${form} on the command line opens it in the editor`, async () => {
    const file = join(dir, 'Open with me.png');
    await writeFile(file, PNG);
    ctx = await launch([form === 'path' ? file : pathToFileURL(file).href]);
    const editor = await pageOf(ctx.app, 'editor');
    await expect(editor.getByTestId('editor-size')).toHaveText('3 × 2');
    await expect(editor.locator('#top .title')).toHaveText('Open with me.png');
  });
}

test('opening an image with anyshot while it runs opens it in the running app', async () => {
  const file = join(dir, 'second.png');
  await writeFile(file, PNG);
  ctx = await launch();
  const userData = ctx.userData;
  // A second start with the same profile hands its arguments to the running app and quits.
  const second = spawn(electronPath, ['.', file], {
    env: {
      ...process.env,
      ANYSHOT_TEST: '1',
      ANYSHOT_USER_DATA: userData,
      XDG_CONFIG_HOME: join(userData, 'config'),
    },
    stdio: 'ignore',
  });
  const code = await new Promise<number | null>((resolve) => second.once('exit', resolve));
  expect(code).toBe(0);
  const editor = await pageOf(ctx.app, 'editor');
  await expect(editor.getByTestId('editor-size')).toHaveText('3 × 2');
  await expect(editor.locator('#top .title')).toHaveText('second.png');
});
