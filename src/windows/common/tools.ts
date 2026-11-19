import { DEFAULT_EFFECTS, type Effects } from '../../engine/model';
import type { ToolOptions } from '../../engine/view';
import type { Settings, ToolId } from '../../shared/settings';
import { createStore, type Store } from './store';

export interface ToolUiState extends ToolOptions {
  presetColors: string[];
  enabledTools: ToolId[];
  canUndo: boolean;
  canRedo: boolean;
  selectedCount: number;
  /** The document's committed image effects. */
  effects: Effects;
  /** Which popover is open, if any. */
  popover: 'color' | 'adjust' | 'beautify' | null;
}

export const TOOL_LABELS: Record<ToolId, string> = {
  select: 'Select and move',
  pencil: 'Pencil',
  line: 'Line',
  arrow: 'Arrow',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  marker: 'Marker',
  text: 'Text',
  number: 'Number',
  censor: 'Censor',
  spotlight: 'Spotlight',
  magnify: 'Magnifier',
  stamp: 'Stamp',
  picker: 'Colour picker',
  measure: 'Measure',
};

/** Single-key tool shortcuts, active once a selection exists. */
export const TOOL_KEYS: Partial<Record<string, ToolId>> = {
  v: 'select',
  p: 'pencil',
  l: 'line',
  a: 'arrow',
  r: 'rect',
  o: 'ellipse',
  m: 'marker',
  t: 'text',
  n: 'number',
  b: 'censor',
  h: 'spotlight',
  i: 'picker',
  g: 'stamp',
};

export const QUICK_STAMPS = [
  '👆',
  '👇',
  '👈',
  '👉',
  '✅',
  '❌',
  '⚠️',
  '❓',
  '🔥',
  '🐛',
  '👀',
  '💡',
  '🎯',
  '⭐',
  '❤️',
  '👍',
  '👎',
];

export function createToolStore(settings: Settings): Store<ToolUiState> {
  const t = settings.tools;
  return createStore<ToolUiState>({
    tool: settings.capture.rememberLastTool ? t.lastTool : 'arrow',
    color: t.color,
    strokeWidth: t.strokeWidth,
    fill: t.fill,
    lineStyle: t.lineStyle,
    textSize: t.textSize,
    censorMode: t.censorMode,
    spotlightDim: t.spotlightDim,
    magnifyZoom: t.magnifyZoom,
    stampSize: t.stampSize,
    stamp: t.stamp,
    presetColors: t.presetColors,
    enabledTools: t.enabledTools,
    canUndo: false,
    canRedo: false,
    selectedCount: 0,
    popover: null,
    effects: DEFAULT_EFFECTS,
  });
}

/** Remembers tool choices in settings, debounced so slider drags write once. */
export function persistToolChoices(store: Store<ToolUiState>): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const snapshot = (s: ToolUiState) => ({
    lastTool: s.tool,
    color: s.color,
    strokeWidth: s.strokeWidth,
    fill: s.fill,
    lineStyle: s.lineStyle,
    textSize: s.textSize,
    censorMode: s.censorMode,
    spotlightDim: s.spotlightDim,
    magnifyZoom: s.magnifyZoom,
    stampSize: s.stampSize,
    stamp: s.stamp,
  });
  let last = JSON.stringify(snapshot(store.get()));
  const unsubscribe = store.subscribe((s) => {
    const tools = snapshot(s);
    const json = JSON.stringify(tools);
    if (json === last) return;
    last = json;
    clearTimeout(timer);
    timer = setTimeout(() => void window.anyshot.invoke('settings:patch', { tools }), 400);
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
