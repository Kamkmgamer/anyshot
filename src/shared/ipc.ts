/**
 * The single IPC contract shared by main, preload and windows. Every channel is
 * declared once with its request and response types, and with the window kinds
 * allowed to call it. Main rejects calls from any other sender.
 */
import type { Rect, Size } from './geometry';
import type { DeepPartial, Settings, ToolChoices, ToolId } from './settings';

export const APP_ORIGIN = 'app://local';

export type WindowKind =
  | 'overlay'
  | 'editor'
  | 'floating'
  | 'pin'
  | 'history'
  | 'settings'
  | 'recorder'
  | 'scroll'
  | 'ocr';

export type CaptureMode =
  | 'area'
  | 'screen'
  | 'ocr'
  | 'quick'
  | 'last'
  | 'record'
  | 'gif'
  | 'scroll';

export interface OverlayInit {
  mode: CaptureMode;
  frameId: string;
  /** Physical pixel size of the frame; the canvas backing store uses this. */
  frame: Size;
  scaleFactor: number;
  /** Display bounds in CSS pixels; the window covers exactly this. */
  bounds: Rect;
  /** The previous selection on this display (CSS px), restored with R or "capture last area". */
  lastSelection: Rect | null;
  /** Full-screen modes select the whole display immediately. */
  selectAll: boolean;
  settings: Settings;
  /** Non-empty when the overlay is a warm instance that will be reused. */
  warm: boolean;
}

export type DeliverAction =
  | 'copy'
  | 'save'
  | 'saveAs'
  | 'quick'
  | 'pin'
  | 'upload'
  | 'ocr'
  | 'editor'
  | 'none';

export interface EncodedImage {
  /** Encoded bytes (PNG unless `mime` says otherwise). */
  bytes: ArrayBuffer;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}

export interface DeliverRequest {
  action: DeliverAction;
  /** Lossless PNG master: clipboard, history and pins use this. */
  image: EncodedImage;
  /** The same image in the configured save format, when that isn't PNG. */
  saveImage?: EncodedImage;
  /** Small WebP preview for history and the floating thumbnail. */
  thumb?: ArrayBuffer;
  /** Screen-space rectangle (CSS px) the image came from, for pins in place. */
  screenRect?: Rect;
  /** History entry being edited: its image is replaced instead of adding a new entry. */
  historyId?: string;
  /** Skip the floating preview (the editor is already showing the image). */
  quiet?: boolean;
}

export interface DeliverResult {
  ok: boolean;
  path?: string;
  url?: string;
  error?: string;
  historyId?: string;
}

export interface RawImage {
  rgba: ArrayBuffer;
  width: number;
  height: number;
}

export type EditorSource =
  | { kind: 'frame'; frameId: string; width: number; height: number }
  | { kind: 'url'; url: string };

export interface EditorInit {
  source: EditorSource;
  /** Serialised annotation document carried over from the overlay or a project. */
  doc: unknown;
  title: string;
  projectPath: string | null;
  historyId: string | null;
  settings: Settings;
}

export interface HistoryEntry {
  id: string;
  createdAt: number;
  width: number;
  height: number;
  kind: 'image' | 'video' | 'gif';
  /** Absolute path of the saved file if the user saved it somewhere. */
  savedPath: string | null;
}

export interface FloatingItem {
  id: string;
  historyId: string;
  width: number;
  height: number;
  createdAt: number;
}

export type ItemAction =
  | 'copy'
  | 'save'
  | 'saveAs'
  | 'pin'
  | 'edit'
  | 'delete'
  | 'reveal'
  | 'drag'
  | 'upload'
  | 'ocr';

export interface PinInit {
  src: string;
  width: number;
  height: number;
  historyId: string;
}

export interface RecordRequest {
  /** Region in CSS px relative to the sender overlay's display. */
  rect: Rect;
  gif: boolean;
}

export interface RecorderInit {
  displayId: number;
  /** Physical pixel size of the whole display, to scale the crop to the stream's size. */
  displaySize: Size;
  /** Crop region in physical pixels of the captured display stream. */
  crop: Rect;
  scaleFactor: number;
  fps: number;
  microphone: boolean;
  gif: boolean;
}

export interface RecorderStatus {
  state: 'starting' | 'recording' | 'paused' | 'finishing' | 'done' | 'error';
  elapsedMs: number;
  bytes: number;
  error?: string;
}

export interface ScrollInit {
  displayId: number;
  displaySize: Size;
  crop: Rect;
  scaleFactor: number;
  maxHeight: number;
}

export interface OcrResult {
  text: string;
  confidence: number;
  qr: string[];
}

export interface Metrics {
  processes: { type: string; pid: number; cpu: number; memoryKB: number }[];
  mainHeapMB: number;
}

type Req<T> = { req: T };
type Res<T> = { res: T };
type Channel<Q, R> = Req<Q> & Res<R>;

export interface InvokeContract {
  'settings:get': Channel<void, Settings>;
  'settings:patch': Channel<DeepPartial<Settings>, Settings>;
  'settings:remember-tools': Channel<Partial<ToolChoices>, void>;
  'window:close': Channel<void, void>;
  'window:set-size': Channel<Size, void>;
  'clipboard:text': Channel<string, void>;
  'shell:open-url': Channel<string, void>;

  'overlay:init': Channel<void, OverlayInit>;
  'overlay:painted': Channel<void, void>;
  'overlay:selection-start': Channel<void, void>;
  'overlay:cancel': Channel<void, void>;
  'overlay:hide': Channel<void, void>;
  'frame:release': Channel<string, void>;

  'capture:deliver': Channel<DeliverRequest, DeliverResult>;
  'capture:to-editor': Channel<{ image: RawImage; doc: unknown }, void>;
  'capture:record': Channel<RecordRequest, void>;
  'capture:scroll': Channel<RecordRequest, void>;
  'capture:remember-area': Channel<{ rect: Rect }, void>;

  'editor:init': Channel<void, EditorInit>;
  'editor:open': Channel<void, boolean>;
  'editor:save-project': Channel<{ bytes: ArrayBuffer; saveAs: boolean }, string | null>;
  'editor:set-title': Channel<{ title: string; dirty: boolean }, void>;

  'history:list': Channel<void, HistoryEntry[]>;
  'history:clear': Channel<void, void>;
  'item:action': Channel<{ historyId: string; action: ItemAction }, DeliverResult>;

  'floating:dismiss': Channel<string, void>;
  'floating:ready': Channel<void, { items: FloatingItem[]; dismissSeconds: number }>;

  'pin:init': Channel<void, PinInit>;
  'pin:move-by': Channel<{ dx: number; dy: number }, void>;
  'pin:ready': Channel<void, void>;

  'recorder:init': Channel<void, RecorderInit>;
  'recorder:open-file': Channel<{ ext: 'mp4' | 'webm' | 'gif' }, string>;
  'recorder:write': Channel<{ path: string; data: Uint8Array; position: number }, void>;
  'recorder:close-file': Channel<{ path: string }, void>;
  'recorder:status': Channel<RecorderStatus, void>;
  'recorder:finish': Channel<{ ok: boolean; error?: string }, void>;
  'recorder:control': Channel<'stop' | 'pause' | 'resume', void>;

  'scroll:init': Channel<void, ScrollInit>;
  'scroll:finish': Channel<{ image: EncodedImage | null; thumb?: ArrayBuffer }, void>;

  'ocr:init': Channel<void, OcrResult>;

  'secrets:status': Channel<
    void,
    { available: boolean; backend: string; keys: string[]; weakOptIn: boolean }
  >;
  'secrets:set': Channel<{ key: string; value: string }, void>;
  'uploads:test': Channel<void, DeliverResult>;
  'settings:choose-dir': Channel<'output' | 'recording', string | null>;
  'settings:set-tool-enabled': Channel<{ tool: ToolId; enabled: boolean }, void>;
}

export type InvokeChannel = keyof InvokeContract;
export type InvokeReq<K extends InvokeChannel> = InvokeContract[K]['req'];
export type InvokeRes<K extends InvokeChannel> = InvokeContract[K]['res'];
export type InvokeArgs<K extends InvokeChannel> = InvokeReq<K> extends void ? [] : [InvokeReq<K>];

const ALL: readonly WindowKind[] = [
  'overlay',
  'editor',
  'floating',
  'pin',
  'history',
  'settings',
  'recorder',
  'scroll',
  'ocr',
];

/** Which window kinds may call each channel. Main enforces this per call. */
export const INVOKE_ACCESS: { readonly [K in InvokeChannel]: readonly WindowKind[] } = {
  'settings:get': ALL,
  'settings:patch': ['settings', 'overlay', 'editor'],
  'settings:remember-tools': ['overlay', 'editor'],
  'window:close': ALL,
  'window:set-size': ['floating', 'pin'],
  'clipboard:text': ['ocr', 'editor', 'overlay', 'settings'],
  'shell:open-url': ['ocr', 'settings', 'floating'],

  'overlay:init': ['overlay'],
  'overlay:painted': ['overlay'],
  'overlay:selection-start': ['overlay'],
  'overlay:cancel': ['overlay'],
  'overlay:hide': ['overlay'],
  'frame:release': ['overlay', 'editor'],

  'capture:deliver': ['overlay', 'editor', 'scroll'],
  'capture:to-editor': ['overlay'],
  'capture:record': ['overlay'],
  'capture:scroll': ['overlay'],
  'capture:remember-area': ['overlay'],

  'editor:init': ['editor'],
  'editor:open': ['editor'],
  'editor:save-project': ['editor'],
  'editor:set-title': ['editor'],

  'history:list': ['history'],
  'history:clear': ['history'],
  'item:action': ['history', 'floating', 'pin'],

  'floating:dismiss': ['floating'],
  'floating:ready': ['floating'],

  'pin:init': ['pin'],
  'pin:move-by': ['pin'],
  'pin:ready': ['pin'],

  'recorder:init': ['recorder'],
  'recorder:open-file': ['recorder'],
  'recorder:write': ['recorder'],
  'recorder:close-file': ['recorder'],
  'recorder:status': ['recorder'],
  'recorder:finish': ['recorder'],
  'recorder:control': ['recorder'],

  'scroll:init': ['scroll'],
  'scroll:finish': ['scroll'],

  'ocr:init': ['ocr'],

  'secrets:status': ['settings'],
  'secrets:set': ['settings'],
  'uploads:test': ['settings'],
  'settings:choose-dir': ['settings'],
  'settings:set-tool-enabled': ['settings'],
};

/** Events pushed from main to windows. */
export interface EventContract {
  'settings:changed': Settings;
  'overlay:clear-selection': undefined;
  'overlay:reset': OverlayInit;
  'floating:items': FloatingItem[];
  'history:changed': undefined;
  'recorder:command': 'stop' | 'pause' | 'resume';
  'recorder:status': RecorderStatus;
  'scroll:command': 'stop' | 'cancel' | 'copy';
}
export type EventChannel = keyof EventContract;

export const EVENT_CHANNELS: readonly EventChannel[] = [
  'settings:changed',
  'overlay:clear-selection',
  'overlay:reset',
  'floating:items',
  'history:changed',
  'recorder:command',
  'recorder:status',
  'scroll:command',
];

/** The API the preload exposes on `window.anyshot`. */
export interface AnyshotApi {
  kind: WindowKind;
  invoke<K extends InvokeChannel>(channel: K, ...args: InvokeArgs<K>): Promise<InvokeRes<K>>;
  on<K extends EventChannel>(channel: K, listener: (payload: EventContract[K]) => void): () => void;
}
