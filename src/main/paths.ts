import { join } from 'node:path';
import { app } from 'electron';

// Lets tests and portable setups point anyshot at an isolated profile.
const override = process.env.ANYSHOT_USER_DATA;
if (override) app.setPath('userData', override);

export const isTest = process.env.ANYSHOT_TEST === '1';

export const paths = {
  get userData() {
    return app.getPath('userData');
  },
  get settingsFile() {
    return join(app.getPath('userData'), 'settings.json');
  },
  get secretsFile() {
    return join(app.getPath('userData'), 'secrets.bin');
  },
  get historyDir() {
    return join(app.getPath('userData'), 'history');
  },
  get defaultSaveDir() {
    return join(app.getPath('pictures'), 'anyshot');
  },
  get defaultRecordingDir() {
    return join(app.getPath('videos'), 'anyshot');
  },
  // Resolved from the app root, not this file: the bundler may move this module into a chunk.
  renderer: join(app.getAppPath(), 'out/renderer'),
  preload: join(app.getAppPath(), 'out/preload/index.cjs'),
  resources: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
  utility: (name: string) => join(app.getAppPath(), `out/main/utility-${name}.js`),
};
