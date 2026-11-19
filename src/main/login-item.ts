import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * Launch at login. Electron's login items cover Windows (and macOS); on Linux
 * we write an XDG autostart entry instead.
 */
export async function applyLaunchAtLogin(enabled: boolean): Promise<void> {
  if (process.platform !== 'linux') {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return;
  }
  const dir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart');
  const file = join(dir, 'anyshot.desktop');
  if (!enabled) {
    await rm(file, { force: true });
    return;
  }
  // AppImages run from a temporary mount; APPIMAGE points at the real file.
  const exec = process.env.APPIMAGE || process.execPath;
  const args = app.isPackaged ? '' : ` "${app.getAppPath()}"`;
  await mkdir(dir, { recursive: true });
  await writeFile(
    file,
    `[Desktop Entry]\nType=Application\nName=anyshot\nExec="${exec}"${args}\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n`,
  );
}
