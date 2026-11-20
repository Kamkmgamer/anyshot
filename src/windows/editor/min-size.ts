/**
 * Keeps the editor window wide enough for its toolbars. The header and the tool
 * strip are single rows: when the window is narrower than their buttons, the end
 * of the row (Save, Pin, Done) is cut off. The page measures what the rows need
 * and main makes that the window's minimum size.
 */

/** The title may shrink to this (with an ellipsis); spacers take no room. */
const TITLE_MIN = 80;
/** Room left for the image below the toolbars. */
const VIEWPORT_MIN = 240;

function px(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** The width a single-row flex container needs to show every item uncut. */
export function rowWidth(row: Element): number {
  const style = getComputedStyle(row);
  const items = [...row.children].filter(
    (item) => item instanceof HTMLElement && getComputedStyle(item).display !== 'none',
  );
  let width =
    px(style.paddingLeft) +
    px(style.paddingRight) +
    px(style.borderLeftWidth) +
    px(style.borderRightWidth);
  width += px(style.columnGap) * Math.max(0, items.length - 1);
  for (const item of items) {
    const itemStyle = getComputedStyle(item);
    width += px(itemStyle.marginLeft) + px(itemStyle.marginRight);
    if (item.classList.contains('spacer')) continue;
    // A nested row (the tool strip, the crop bar) needs its own items' width.
    const inner = itemStyle.display.includes('flex') ? rowWidth(item) : 0;
    const own = Math.max(item.getBoundingClientRect().width, inner);
    width += item.classList.contains('title') ? Math.min(own, TITLE_MIN) : own;
  }
  return Math.ceil(width);
}

export interface MinSizeParts {
  /** The header row. */
  top: HTMLElement;
  /** The tools area; its rows wrap, but the tool strip itself is one row. */
  tools: HTMLElement;
  strip: () => Element | null;
}

/** The smallest window content size that shows the whole header and tool strip. */
export function minimumSize(parts: MinSizeParts): { width: number; height: number } {
  const strip = parts.strip();
  const toolsStyle = getComputedStyle(parts.tools);
  const toolsWidth = strip
    ? rowWidth(strip) + px(toolsStyle.paddingLeft) + px(toolsStyle.paddingRight)
    : 0;
  return {
    width: Math.max(rowWidth(parts.top), toolsWidth),
    height: Math.ceil(parts.top.offsetHeight + parts.tools.offsetHeight + VIEWPORT_MIN),
  };
}

/**
 * Reports the minimum size whenever the toolbars change (a crop bar appears,
 * fonts load) and returns the cleanup.
 */
export function watchMinimumSize(
  parts: MinSizeParts,
  report: (size: { width: number; height: number }) => void,
): () => void {
  let last = '';
  let frame = 0;
  const measure = () => {
    frame = 0;
    const size = minimumSize(parts);
    const key = `${size.width}x${size.height}`;
    if (key === last) return;
    last = key;
    report(size);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure);
  };
  const mutations = new MutationObserver(schedule);
  for (const el of [parts.top, parts.tools])
    mutations.observe(el, { childList: true, subtree: true, characterData: true });
  const resizes = new ResizeObserver(schedule);
  resizes.observe(parts.top);
  resizes.observe(parts.tools);
  void document.fonts.ready.then(schedule);
  schedule();
  return () => {
    mutations.disconnect();
    resizes.disconnect();
    cancelAnimationFrame(frame);
  };
}
