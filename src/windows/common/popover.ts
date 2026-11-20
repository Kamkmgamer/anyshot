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

const FOCUSABLE = '.popover button:not(:disabled), .popover input, .popover select';

/**
 * Closes the open tool popover on a press outside it or on Esc, and handles
 * focus like a dialog: opened from the keyboard, focus moves to its first
 * control; closed with focus inside, focus returns to its button. Opened with
 * the mouse, focus stays put (an open text box keeps it). Returns the cleanup.
 */
export function dismissPopovers(store: Store<ToolUiState>, root: Window = window): () => void {
  let keyboard = false;
  /** A pending move of focus into a popover just opened from the keyboard. */
  let pendingFocus = 0;
  const cancelFocus = () => {
    root.cancelAnimationFrame(pendingFocus);
    pendingFocus = 0;
  };
  const onPointerDown = (e: PointerEvent) => {
    keyboard = false;
    // The pointer took over: don't pull focus back to the popover's first control.
    cancelFocus();
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
    keyboard = true;
    if (e.key !== 'Escape' || !store.get().popover) return;
    // Esc closes the popover first; the window's own Esc (cancel, close) waits for the next one.
    store.set({ popover: null });
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  // Capture phase: toolbars stop their pointerdown from bubbling to the canvas.
  let open = store.get().popover;
  const stopWatching = store.subscribe((s) => {
    if (s.popover === open) return;
    open = s.popover;
    cancelFocus();
    const doc = root.document;
    // Still the old DOM: the button of the popover that is closing says it is expanded.
    const opener = doc.querySelector<HTMLElement>('[aria-haspopup="dialog"][aria-expanded="true"]');
    const focusInside = doc.activeElement?.closest('.popover') != null;
    if (focusInside && opener) opener.focus();
    if (s.popover && keyboard)
      pendingFocus = root.requestAnimationFrame(() => {
        pendingFocus = 0;
        doc.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      });
  });
  root.addEventListener('pointerdown', onPointerDown, true);
  root.addEventListener('keydown', onKeyDown, true);
  return () => {
    cancelFocus();
    stopWatching();
    root.removeEventListener('pointerdown', onPointerDown, true);
    root.removeEventListener('keydown', onKeyDown, true);
  };
}
