import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from 'electron';
import {
  APP_ORIGIN,
  INVOKE_ACCESS,
  type InvokeChannel,
  type InvokeReq,
  type InvokeRes,
  type WindowKind,
} from '../shared/ipc';
import { windowEntry } from './windows';

export interface HandlerContext {
  win: BrowserWindow;
  kind: WindowKind;
  event: IpcMainInvokeEvent;
}

type Handler<K extends InvokeChannel> = (
  req: InvokeReq<K>,
  ctx: HandlerContext,
) => InvokeRes<K> | Promise<InvokeRes<K>>;

/** Validates that a call comes from one of our own pages in an allowed window kind. */
export function authorize(channel: InvokeChannel, event: IpcMainInvokeEvent): HandlerContext {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame || !frame.url.startsWith(`${APP_ORIGIN}/`)) {
    throw new Error(`Rejected ${channel}: untrusted sender`);
  }
  const entry = windowEntry(event.sender.id);
  if (!entry || !INVOKE_ACCESS[channel].includes(entry.kind)) {
    throw new Error(`Rejected ${channel}: not allowed for ${entry?.kind ?? 'unknown window'}`);
  }
  return { win: entry.win, kind: entry.kind, event };
}

export function handle<K extends InvokeChannel>(channel: K, handler: Handler<K>): void {
  ipcMain.handle(channel, (event, req: InvokeReq<K>) => handler(req, authorize(channel, event)));
}
