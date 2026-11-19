import { contextBridge, ipcRenderer } from 'electron';
import {
  type AnyshotApi,
  EVENT_CHANNELS,
  type EventChannel,
  INVOKE_ACCESS,
  type InvokeChannel,
  type WindowKind,
} from '../shared/ipc';

const kindArg = process.argv.find((arg) => arg.startsWith('--anyshot-kind='));
const kind = (kindArg?.slice('--anyshot-kind='.length) ?? 'overlay') as WindowKind;

const api: AnyshotApi = {
  kind,
  invoke: (channel: InvokeChannel, ...args: unknown[]) => {
    if (!(channel in INVOKE_ACCESS)) return Promise.reject(new Error(`Unknown channel ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel: EventChannel, listener: (payload: unknown) => void) => {
    if (!EVENT_CHANNELS.includes(channel)) throw new Error(`Unknown event ${channel}`);
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
} as AnyshotApi;

contextBridge.exposeInMainWorld('anyshot', api);
