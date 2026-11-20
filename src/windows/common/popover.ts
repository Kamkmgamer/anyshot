import type { Store } from './store';
import type { ToolUiState } from './tools';

/** Something `closest` can be asked about: an Element, or a stand-in in tests. */
export interface PressTarget {
  closest(selector: string): unknown;
}

/** Presses inside these keep the popover open: the popover itself and the buttons that toggle one. */
const KEEPS_OPEN = '.popover, [aria-haspopup="dialog"]';
/** Controls that still do their job after the press closes the popover (another tool, undo). */
const CONTROLS = '[role="toolbar"], button, input, select, textarea, label, a';

/**
 * What a press does to an open popover: nothing when it is inside it (or on a
 * popover toggle, which toggles it itself); otherwise the popover closes. A press
 * on the canvas or the page only closes it, so it doesn't also start a drawing
 * or a new selection; a press on another control closes it and still acts.
 */
export function pressOutcome(target: PressTarget | null): 'keep' | 'close' | 'close-only' {
  if (!target) return 'close-only';
  if (target.closest(KEEPS_OPEN)) return 'keep';
  return target.closest(CONTROLS) ? 'close' : 'close-only';
}

/** Closes the open tool popover on a press outside it or on Esc. Returns the cleanup. */
export function dismissPopovers(store: Store<ToolUiState>, root: Window = window): () => void {
  const onPointerDown = (e: PointerEvent) => {
    if (!store.get().popover) return;
    const outcome = pressOutcome(e.target instanceof Element ? e.target : null);
    if (outcome === 'keep') return;
    store.set({ popover: null });
    if (outcome === 'close-only') {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !store.get().popover) return;
    // Esc closes the popover first; the window's own Esc (cancel, close) waits for the next one.
    store.set({ popover: null });
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  // Capture phase: toolbars stop their pointerdown from bubbling to the canvas.
  root.addEventListener('pointerdown', onPointerDown, true);
  root.addEventListener('keydown', onKeyDown, true);
  return () => {
    root.removeEventListener('pointerdown', onPointerDown, true);
    root.removeEventListener('keydown', onKeyDown, true);
  };
}
