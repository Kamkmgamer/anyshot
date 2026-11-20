import { describe, expect, it } from 'vitest';
import { parseAnnotation } from '../../src/engine/document';
import { DEFAULT_TEXT_STYLE, type TextAnnotation } from '../../src/engine/model';
import { drawAnnotation, type RenderEnv, textOutline } from '../../src/engine/render';
import { estimateTextWidth, setTextMeasurer, textBox, textFont } from '../../src/engine/shapes';
import { restyle } from '../../src/engine/view';
import { DEFAULT_SETTINGS, parseSettings } from '../../src/shared/settings';
import { selectedTextStyle } from '../../src/windows/common/annotator';
import { shownTextStyle, stepTextSize } from '../../src/windows/common/text-style-ui';
import { createToolStore } from '../../src/windows/common/tools';

const text: TextAnnotation = {
  id: 't',
  kind: 'text',
  at: { x: 10, y: 20 },
  text: 'Hello\nworld',
  size: 20,
  color: '#ff0000',
  background: false,
  style: DEFAULT_TEXT_STYLE,
};

describe('text styles', () => {
  it('builds the font from the style', () => {
    // Unstyled text keeps the look it had before styles existed.
    expect(textFont(24)).toBe(textFont(24, DEFAULT_TEXT_STYLE));
    expect(textFont(24)).toMatch(/^600 24px "Segoe UI"/);
    const font = textFont(30, { ...DEFAULT_TEXT_STYLE, font: 'serif', bold: false, italic: true });
    expect(font).toMatch(/^italic 400 30px Georgia/);
    expect(font).toMatch(/serif$/);
    expect(textFont(12, { ...DEFAULT_TEXT_STYLE, font: 'mono' })).toMatch(/monospace$/);
    expect(textFont(12, { ...DEFAULT_TEXT_STYLE, font: 'hand' })).toMatch(/cursive$/);
  });

  it('widens the box of italic text by its lean', () => {
    setTextMeasurer(estimateTextWidth);
    const upright = textBox(text);
    const italic = textBox({ ...text, style: { ...text.style, italic: true } });
    expect(italic.width - upright.width).toBeCloseTo(20 * 0.2);
    expect(italic.height).toBe(upright.height);
  });

  it('reads older documents without a style as the default style', () => {
    const { style: _style, ...old } = text;
    expect(parseAnnotation(JSON.parse(JSON.stringify(old)))).toEqual(text);
  });

  it('keeps valid style fields and defaults malformed ones', () => {
    const parsed = parseAnnotation({
      ...text,
      style: { font: 'comic', bold: false, italic: 'yes', underline: true, outline: false },
    });
    expect(parsed).toEqual({
      ...text,
      style: { font: 'sans', bold: false, italic: false, underline: true, outline: false },
    });
  });

  it('restyles text from the tool options, scaling the size by the unit', () => {
    const next = restyle(
      text,
      { textSize: 30, textFont: 'mono', textItalic: true, textOutline: false, color: '#00ff00' },
      2,
    );
    expect(next).toEqual({
      ...text,
      size: 60,
      color: '#00ff00',
      style: { font: 'mono', bold: true, italic: true, underline: false, outline: false },
    });
    // Options that aren't about text leave it alone.
    expect(restyle(text, { strokeWidth: 9, lineStyle: 'dashed' }, 1)).toEqual(text);
  });

  it('steps the size so up and down retrace each other', () => {
    expect(stepTextSize(20, 1)).toBe(22);
    expect(stepTextSize(24, 1)).toBe(28);
    expect(stepTextSize(28, -1)).toBe(24);
    expect(stepTextSize(24, -1)).toBe(22);
    expect(stepTextSize(64, 1)).toBe(72);
    expect(stepTextSize(72, -1)).toBe(64);
    expect(stepTextSize(8, -1)).toBe(8);
    expect(stepTextSize(200, 1)).toBe(200);
    for (const size of [8, 12, 22, 24, 30, 60, 64, 100, 184])
      expect(stepTextSize(stepTextSize(size, 1), -1)).toBe(size);
  });

  it('defaults the tool to the old look', () => {
    const t = DEFAULT_SETTINGS.tools;
    expect({
      font: t.textFont,
      bold: t.textBold,
      italic: t.textItalic,
      underline: t.textUnderline,
      outline: t.textOutline,
    }).toEqual(DEFAULT_TEXT_STYLE);
    // A saved font that no longer exists falls back to the default.
    expect(parseSettings({ tools: { textFont: 'comic' } }).tools.textFont).toBe('sans');
  });
});

/** Records the drawing calls a text annotation makes. */
function recordText(a: TextAnnotation): string[] {
  const calls: string[] = [];
  const ctx = new Proxy(
    { measureText: (s: string) => ({ width: s.length * 10 }) },
    {
      get(target, key) {
        if (key === 'measureText') return target.measureText;
        return (...args: unknown[]) => calls.push(`${String(key)}(${args.join(',')})`);
      },
      set(_target, key, value) {
        calls.push(`${String(key)}=${value}`);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  drawAnnotation(ctx, a, {} as RenderEnv);
  return calls;
}

describe('text rendering', () => {
  it('outlines the letters only when the style asks for it', () => {
    expect(recordText(text).filter((c) => c.startsWith('strokeText'))).toHaveLength(2);
    const plain = recordText({ ...text, style: { ...text.style, outline: false } });
    expect(plain.filter((c) => c.startsWith('strokeText'))).toEqual([]);
    expect(plain.filter((c) => c.startsWith('fillText'))).toHaveLength(2);
  });

  it('underlines each non-empty line at its measured width', () => {
    const calls = recordText({
      ...text,
      text: 'Hello\n\nworld!',
      style: { ...text.style, underline: true, outline: false },
    });
    // 20 px text: the line sits 0.95 em below the line's top, 1.4 px thick.
    expect(calls.filter((c) => c.startsWith('fillRect'))).toEqual([
      `fillRect(10,${20 + 1.6 + 19},50,1.4000000000000001)`,
      `fillRect(10,${20 + 2 * 25 + 1.6 + 19},60,1.4000000000000001)`,
    ]);
  });

  it('sets the styled font', () => {
    const calls = recordText({ ...text, style: { ...text.style, font: 'serif', italic: true } });
    expect(calls).toContain(`font=${textFont(20, { ...text.style, font: 'serif', italic: true })}`);
  });
});

describe('text style shown for the selection', () => {
  it('reads the first selected text, its size in tool units', () => {
    const other: TextAnnotation = { ...text, id: 'u', style: { ...text.style, italic: true } };
    const style = selectedTextStyle([text, other], new Set(['u', 't']), 2);
    expect(style).toEqual({ ...text.style, size: 10, color: '#ff0000' });
    expect(selectedTextStyle([text], new Set(), 1)).toBeNull();
  });

  it('shows the selection with the select tool, the remembered style otherwise', () => {
    const store = createToolStore(DEFAULT_SETTINGS);
    const selected = { ...DEFAULT_TEXT_STYLE, italic: true, size: 50, color: '#00ff00' };
    store.set({ tool: 'select', selectedTextStyle: selected, textItalic: false });
    expect(shownTextStyle(store.get())).toEqual(selected);
    store.set({ tool: 'text' });
    expect(shownTextStyle(store.get())).toMatchObject({ italic: false, size: 28 });
  });

  it('describes the outline the canvas and the edit box draw', () => {
    expect(textOutline(text)).toEqual({ width: 2.4, color: 'rgba(255,255,255,0.85)' });
    expect(textOutline({ ...text, color: '#ffffff' })?.color).toBe('rgba(0,0,0,0.6)');
    expect(textOutline({ ...text, style: { ...text.style, outline: false } })).toBeNull();
    expect(textOutline({ ...text, background: true })).toBeNull();
  });
});
