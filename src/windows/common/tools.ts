import { DEFAULT_EFFECTS, type Effects, type TextStyle } from '../../engine/model';
import type { ToolOptions } from '../../engine/view';
import type { Settings, ToolChoices, ToolId } from '../../shared/settings';
import { createStore, type Store } from './store';

export interface ToolUiState extends ToolOptions {
  presetColors: string[];
  enabledTools: ToolId[];
  canUndo: boolean;
  canRedo: boolean;
  selectedCount: number;
  /** The style of the first selected text annotation (size in tool units), if any is selected. */
  selectedTextStyle: SelectedTextStyle | null;
  /** The document's committed image effects. */
  effects: Effects;
  /** Effects shown while a slider is being dragged, not yet committed. */
  previewEffects: Effects | null;
  /** Which popover is open, if any. */
  popover: 'color' | 'adjust' | 'beautify' | 'text' | null;
}

export interface SelectedTextStyle extends TextStyle {
  size: number;
  color: string;
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
    textFont: t.textFont,
    textBold: t.textBold,
    textItalic: t.textItalic,
    textUnderline: t.textUnderline,
    textOutline: t.textOutline,
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
    selectedTextStyle: null,
    popover: null,
    effects: DEFAULT_EFFECTS,
    previewEffects: null,
  });
}

/** Sends only the settings changed by this annotator. Main debounces the disk writes. */
export function persistToolChoices(store: Store<ToolUiState>): () => void {
  const snapshot = (s: ToolUiState): ToolChoices => ({
    lastTool: s.tool,
    color: s.color,
    strokeWidth: s.strokeWidth,
    fill: s.fill,
    lineStyle: s.lineStyle,
    textSize: s.textSize,
    textFont: s.textFont,
    textBold: s.textBold,
    textItalic: s.textItalic,
    textUnderline: s.textUnderline,
    textOutline: s.textOutline,
    censorMode: s.censorMode,
    spotlightDim: s.spotlightDim,
    magnifyZoom: s.magnifyZoom,
    stampSize: s.stampSize,
    stamp: s.stamp,
  });
  let last = snapshot(store.get());
  const keys = Object.keys(last) as (keyof ToolChoices)[];
  return store.subscribe((s) => {
    const next = snapshot(s);
    const changed: Partial<ToolChoices> = {};
    for (const key of keys) {
      if (last[key] !== next[key]) Object.assign(changed, { [key]: next[key] });
    }
    last = next;
    if (Object.keys(changed).length === 0) return;
    void window.anyshot
      .invoke('settings:remember-tools', changed)
      .catch((error) => console.warn('[tools] could not remember choices', error));
  });
}
