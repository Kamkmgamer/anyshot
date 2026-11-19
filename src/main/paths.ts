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
  renderer: join(import.meta.dirname, '../renderer'),
  preload: join(import.meta.dirname, '../preload/index.cjs'),
  resources: app.isPackaged ? process.resourcesPath : join(import.meta.dirname, '../../resources'),
  utility: (name: string) => join(import.meta.dirname, `utility-${name}.js`),
};
