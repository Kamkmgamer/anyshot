import type { ComponentChildren } from 'preact';
import type { Effects } from '../../engine/model';
import type { ToolOptions } from '../../engine/view';
import type { ToolId } from '../../shared/settings';
import { Icon, type IconName } from './icons';
import { usePressRepeat } from './repeat';
import type { Store } from './store';
import { useStore } from './store';
import { TextStyleButton } from './text-style-ui';
import { QUICK_STAMPS, TOOL_KEYS, TOOL_LABELS, type ToolUiState } from './tools';

/** What the toolbars can ask the host window to do. */
export interface Controller {
  store: Store<ToolUiState>;
  /** Image effects (invert, adjust, beautify). `set` is one undo step; `preview` is not recorded. */
  effects: {
    set(effects: Effects): void;
    preview(effects: Effects | null): void;
  };
  setTool(tool: ToolId): void;
  setOptions(patch: Partial<ToolOptions>): void;
  undo(): void;
  redo(): void;
}

const KEY_FOR_TOOL = Object.fromEntries(
  Object.entries(TOOL_KEYS).map(([key, tool]) => [tool, key.toUpperCase()]),
) as Partial<Record<ToolId, string>>;

const stop = (e: Event) => e.stopPropagation();

export function Button(props: {
  icon: IconName;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId?: string;
  danger?: boolean;
  /** Set for buttons that toggle a popover: whether it is open. */
  expanded?: boolean;
}) {
  const popover = props.expanded !== undefined;
  return (
    <button
      type="button"
      class={`tb-btn${props.active ? ' active' : ''}${props.danger ? ' danger' : ''}`}
      title={props.label}
      aria-label={props.label}
      aria-pressed={popover ? undefined : props.active}
      aria-haspopup={popover ? 'dialog' : undefined}
      aria-expanded={popover ? props.expanded : undefined}
      disabled={props.disabled}
      data-testid={props.testId}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
    </button>
  );
}

/** A toolbar button that repeats its action while held (zoom in/out). */
export function RepeatButton(props: {
  icon: IconName;
  label: string;
  onStep: () => void;
  testId?: string;
}) {
  const press = usePressRepeat(props.onStep);
  return (
    <button
      type="button"
      class="tb-btn"
      title={props.label}
      aria-label={props.label}
      data-testid={props.testId}
      {...press}
    >
      <Icon name={props.icon} />
    </button>
  );
}

export function Bar(props: {
  children: ComponentChildren;
  vertical?: boolean;
  class?: string;
  testId?: string;
}) {
  return (
    <div
      role="toolbar"
      class={`bar${props.vertical ? ' vertical' : ''} ${props.class ?? ''}`}
      data-testid={props.testId}
      onPointerDown={stop}
      onDblClick={stop}
    >
      {props.children}
    </div>
  );
}

export function ToolStrip({ c, extra }: { c: Controller; extra?: ComponentChildren }) {
  const s = useStore(c.store, (s) => ({
    tool: s.tool,
    color: s.color,
    canUndo: s.canUndo,
    canRedo: s.canRedo,
    enabled: s.enabledTools,
    popover: s.popover,
  }));
  return (
    <>
      {s.enabled.map((tool) => {
        const key = KEY_FOR_TOOL[tool];
        return (
          <Button
            key={tool}
            icon={tool}
            label={key ? `${TOOL_LABELS[tool]} (${key})` : TOOL_LABELS[tool]}
            active={s.tool === tool}
            testId={`tool-${tool}`}
            onClick={() => c.setTool(tool)}
          />
        );
      })}
      <span class="sep" />
      <button
        type="button"
        class="tb-btn swatch-btn"
        title="Colour"
        aria-label="Colour"
        aria-haspopup="dialog"
        aria-expanded={s.popover === 'color'}
        data-testid="color"
        onClick={() => c.store.set({ popover: s.popover === 'color' ? null : 'color' })}
      >
        <span class="swatch" style={{ background: s.color }} />
      </button>
      <Button
        icon="undo"
        label="Undo (Ctrl+Z)"
        disabled={!s.canUndo}
        onClick={c.undo}
        testId="undo"
      />
      <Button
        icon="redo"
        label="Redo (Ctrl+Shift+Z)"
        disabled={!s.canRedo}
        onClick={c.redo}
        testId="redo"
      />
      {extra}
    </>
  );
}

export function ColorPopover({ c }: { c: Controller }) {
  const s = useStore(c.store, (s) => ({
    color: s.color,
    presets: s.presetColors,
    open: s.popover === 'color',
  }));
  if (!s.open) return null;
  return (
    <div
      class="popover colors"
      role="dialog"
      aria-label="Colour"
      onPointerDown={stop}
      data-testid="color-popover"
    >
      {s.presets.map((color) => (
        <button
          type="button"
          key={color}
          class={`swatch big${color === s.color ? ' active' : ''}`}
          style={{ background: color }}
          title={color}
          aria-label={color}
          onClick={() => {
            c.setOptions({ color });
            c.store.set({ popover: null });
          }}
        />
      ))}
      <label class="custom-color" title="Custom colour">
        <input
          type="color"
          value={s.color.slice(0, 7)}
          onInput={(e) => c.setOptions({ color: (e.target as HTMLInputElement).value })}
        />
        <span>Custom</span>
      </label>
    </div>
  );
}

function Slider(props: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  format?: (v: number) => string;
  onInput: (v: number) => void;
}) {
  return (
    <label class="opt slider">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onInput={(e) => props.onInput(Number((e.target as HTMLInputElement).value))}
      />
      <span class="val">{props.format ? props.format(props.value) : props.value}</span>
    </label>
  );
}

function Segmented<T extends string>(props: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div class="opt seg">
      {props.options.map((o) => (
        <button
          type="button"
          key={o.value}
          aria-pressed={o.value === props.value}
          class={o.value === props.value ? 'active' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const STROKE_TOOLS: ToolId[] = [
  'pencil',
  'line',
  'arrow',
  'rect',
  'ellipse',
  'marker',
  'measure',
  'number',
];
const STYLED_TOOLS: ToolId[] = ['pencil', 'line', 'arrow', 'rect', 'ellipse'];

/** Per-tool options. When annotations are selected, edits apply to them too. */
export function OptionsRow({ c }: { c: Controller }) {
  const s = useStore(c.store, (s) => ({ ...s, presetColors: undefined, enabledTools: undefined }));
  const set = c.setOptions;
  const parts: ComponentChildren[] = [];
  if (STROKE_TOOLS.includes(s.tool) || (s.tool === 'select' && s.selectedCount > 0)) {
    parts.push(
      <Slider
        key="w"
        label={s.tool === 'number' ? 'Size' : 'Stroke'}
        min={1}
        max={30}
        value={s.strokeWidth}
        onInput={(v) => set({ strokeWidth: v })}
      />,
    );
  }
  if (STYLED_TOOLS.includes(s.tool) || (s.tool === 'select' && s.selectedCount > 0)) {
    parts.push(
      <Segmented
        key="ls"
        value={s.lineStyle}
        onChange={(v) => set({ lineStyle: v })}
        options={[
          { value: 'solid', label: 'Solid' },
          { value: 'dashed', label: 'Dashed' },
          { value: 'dotted', label: 'Dotted' },
        ]}
      />,
    );
  }
  if (s.tool === 'rect' || s.tool === 'ellipse') {
    parts.push(
      <Segmented
        key="fill"
        value={s.fill}
        onChange={(v) => set({ fill: v })}
        options={[
          { value: 'stroke', label: 'Outline' },
          { value: 'both', label: 'Outline + fill' },
          { value: 'fill', label: 'Fill' },
        ]}
      />,
    );
  }
  if (s.tool === 'text' || (s.tool === 'select' && s.selectedTextStyle !== null))
    parts.push(<TextStyleButton key="ts" c={c} />);
  if (s.tool === 'text')
    parts.push(
      <span key="text-hint" class="opt hint">
        Click to type · Enter places it · Shift+Enter for a new line
      </span>,
    );
  if (s.tool === 'censor') {
    parts.push(
      <Segmented
        key="cm"
        value={s.censorMode}
        onChange={(v) => set({ censorMode: v })}
        options={[
          { value: 'pixelate', label: 'Pixelate' },
          { value: 'blur', label: 'Blur' },
          { value: 'solid', label: 'Solid' },
        ]}
      />,
    );
  }
  if (s.tool === 'spotlight') {
    parts.push(
      <Slider
        key="dim"
        label="Dim"
        min={10}
        max={95}
        value={s.spotlightDim}
        format={(v) => `${v}%`}
        onInput={(v) => set({ spotlightDim: v })}
      />,
    );
  }
  if (s.tool === 'magnify') {
    parts.push(
      <Slider
        key="z"
        label="Zoom"
        min={1.1}
        max={6}
        step={0.1}
        value={s.magnifyZoom}
        format={(v) => `${v.toFixed(1)}×`}
        onInput={(v) => set({ magnifyZoom: v })}
      />,
    );
  }
  if (s.tool === 'stamp') {
    parts.push(
      <div key="stamps" class="opt stamps">
        {QUICK_STAMPS.map((e) => (
          <button
            type="button"
            key={e}
            class={e === s.stamp ? 'active' : ''}
            onClick={() => set({ stamp: e })}
          >
            {e}
          </button>
        ))}
      </div>,
      <Slider
        key="ss"
        label="Size"
        min={16}
        max={256}
        value={s.stampSize}
        onInput={(v) => set({ stampSize: v })}
      />,
    );
  }
  if (s.tool === 'picker')
    parts.push(
      <span key="hint" class="opt hint">
        Click to use a colour · Shift+click copies its hex
      </span>,
    );
  if (s.tool === 'select' && s.selectedCount === 0) {
    parts.push(
      <span key="hint" class="opt hint">
        Click an annotation to select it · Del removes · Ctrl+D duplicates
      </span>,
    );
  }
  if (parts.length === 0) return null;
  return (
    <Bar class="options" testId="options">
      {parts}
    </Bar>
  );
}
