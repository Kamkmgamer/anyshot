import type { ComponentChildren } from 'preact';
import { TEXT_FAMILIES } from '../../engine/shapes';
import { TEXT_FONTS, type TextFont } from '../../shared/settings';
import { useStore } from './store';
import type { Controller } from './toolbar';
import type { SelectedTextStyle, ToolUiState } from './tools';

const FONT_LABELS: Record<TextFont, string> = {
  sans: 'Sans',
  serif: 'Serif',
  mono: 'Mono',
  hand: 'Hand',
};

export const TEXT_SIZE = { min: 8, max: 200 };
const SIZE_PRESETS = [16, 24, 36, 48, 72];

/** The next text size up or down: steps of 2 up to 24, 4 up to 64, then 8, so up and down retrace each other. */
export function stepTextSize(size: number, direction: 1 | -1): number {
  const clamp = (v: number) => Math.max(TEXT_SIZE.min, Math.min(TEXT_SIZE.max, v));
  const up = (v: number) => v + (v < 24 ? 2 : v < 64 ? 4 : 8);
  if (direction > 0) return clamp(up(size));
  // Smaller undoes Larger: the size one step up from it, whatever band that step started in.
  const from = [8, 4, 2].map((step) => size - step).find((v) => up(v) === size);
  return clamp(from ?? size - (size <= 24 ? 2 : size <= 64 ? 4 : 8));
}

/**
 * The style the popover shows and toggles: the selected text's with the select
 * tool (the first one, when several are selected), else the text tool's own.
 */
export function shownTextStyle(s: ToolUiState): SelectedTextStyle {
  const selected = s.tool === 'select' ? s.selectedTextStyle : null;
  return (
    selected ?? {
      font: s.textFont,
      bold: s.textBold,
      italic: s.textItalic,
      underline: s.textUnderline,
      outline: s.textOutline,
      size: s.textSize,
      color: s.color,
    }
  );
}

/**
 * Buttons that don't take focus when pressed: an open text box keeps it, so
 * style changes apply to it live instead of committing it.
 */
function keepTextFocus(e: PointerEvent): void {
  e.stopPropagation();
  if (e.target instanceof Element && e.target.closest('button')) e.preventDefault();
}

/** The options-row button that opens the text style popover; it previews the style. */
export function TextStyleButton({ c }: { c: Controller }) {
  const s = useStore(c.store, (s) => ({ open: s.popover === 'text', ...shownTextStyle(s) }));
  return (
    <button
      type="button"
      class="text-style-btn"
      title="Text style"
      aria-label="Text style"
      aria-haspopup="dialog"
      aria-expanded={s.open}
      data-testid="text-style"
      onPointerDown={keepTextFocus}
      onClick={() => c.store.set({ popover: s.open ? null : 'text' })}
    >
      <span
        class="sample"
        style={{
          fontFamily: TEXT_FAMILIES[s.font],
          fontWeight: s.bold ? 600 : 400,
          fontStyle: s.italic ? 'italic' : 'normal',
          textDecoration: s.underline ? 'underline' : 'none',
          color: s.color,
        }}
      >
        Aa
      </span>
      <span>
        {FONT_LABELS[s.font]} · {s.size}
      </span>
    </button>
  );
}

function Toggle(props: {
  label: string;
  pressed: boolean;
  testId: string;
  onToggle: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.pressed}
      class={props.pressed ? 'active' : ''}
      data-testid={props.testId}
      onClick={props.onToggle}
    >
      {props.children}
    </button>
  );
}

/** Font, weight, slant, underline, outline, size and colour of the text tool (and selected text). */
export function TextPopover({ c }: { c: Controller }) {
  const s = useStore(c.store, (s) => ({
    open: s.popover === 'text',
    ...shownTextStyle(s),
    presets: s.presetColors,
  }));
  if (!s.open) return null;
  const set = c.setOptions;
  return (
    <div
      class="popover text-style"
      role="dialog"
      aria-label="Text style"
      data-testid="text-popover"
      onPointerDown={keepTextFocus}
    >
      <fieldset class="opt seg fonts" aria-label="Font">
        {TEXT_FONTS.map((font) => (
          <button
            type="button"
            key={font}
            aria-pressed={font === s.font}
            class={font === s.font ? 'active' : ''}
            style={{ fontFamily: TEXT_FAMILIES[font] }}
            data-testid={`text-font-${font}`}
            onClick={() => set({ textFont: font })}
          >
            {FONT_LABELS[font]}
          </button>
        ))}
      </fieldset>
      <fieldset class="opt seg" aria-label="Style">
        <Toggle
          label="Bold"
          pressed={s.bold}
          testId="text-bold"
          onToggle={() => set({ textBold: !s.bold })}
        >
          <b>B</b>
        </Toggle>
        <Toggle
          label="Italic"
          pressed={s.italic}
          testId="text-italic"
          onToggle={() => set({ textItalic: !s.italic })}
        >
          <i style={{ fontFamily: 'Georgia, serif' }}>I</i>
        </Toggle>
        <Toggle
          label="Underline"
          pressed={s.underline}
          testId="text-underline"
          onToggle={() => set({ textUnderline: !s.underline })}
        >
          <u>U</u>
        </Toggle>
        <Toggle
          label="Outline"
          pressed={s.outline}
          testId="text-outline"
          onToggle={() => set({ textOutline: !s.outline })}
        >
          <span class="outlined">Outline</span>
        </Toggle>
      </fieldset>
      <fieldset class="opt sizes" aria-label="Size">
        <span>Size</span>
        <button
          type="button"
          aria-label="Smaller"
          data-testid="text-size-down"
          disabled={s.size <= TEXT_SIZE.min}
          onClick={() => set({ textSize: stepTextSize(s.size, -1) })}
        >
          −
        </button>
        <span class="val" data-testid="text-size">
          {s.size}
        </span>
        <button
          type="button"
          aria-label="Larger"
          data-testid="text-size-up"
          disabled={s.size >= TEXT_SIZE.max}
          onClick={() => set({ textSize: stepTextSize(s.size, 1) })}
        >
          +
        </button>
        {SIZE_PRESETS.map((size) => (
          <button
            type="button"
            key={size}
            class={size === s.size ? 'active' : ''}
            aria-pressed={size === s.size}
            onClick={() => set({ textSize: size })}
          >
            {size}
          </button>
        ))}
      </fieldset>
      <fieldset class="swatches" aria-label="Colour">
        {s.presets.map((color) => (
          <button
            type="button"
            key={color}
            class={`swatch big${color === s.color ? ' active' : ''}`}
            style={{ background: color }}
            title={color}
            aria-label={color}
            aria-pressed={color === s.color}
            onClick={() => set({ color })}
          />
        ))}
      </fieldset>
    </div>
  );
}
