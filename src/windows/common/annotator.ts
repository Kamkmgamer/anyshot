import { DocStore } from '../../engine/document';
import type { Doc } from '../../engine/model';
import { CanvasView, type ToolOptions } from '../../engine/view';
import type { Settings, ToolId } from '../../shared/settings';
import { dismissPopovers } from './popover';
import type { Controller } from './toolbar';
import { createToolStore, persistToolChoices, TOOL_KEYS } from './tools';

export interface Annotator {
  docs: DocStore;
  view: CanvasView;
  controller: Controller;
  /** Undo/redo, tool keys and annotation edits. Returns true if the key was used. */
  handleKey(e: KeyboardEvent): boolean;
  dispose(): void;
}

export function nativeInputOwnsKey(event: KeyboardEvent): boolean {
  const target = event.target;
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select'))
  );
}

/** Wires the engine, the tool store and the keyboard together for a window. */
export function createAnnotator(
  container: HTMLElement,
  size: { width: number; height: number },
  doc: Doc,
  settings: Settings,
): Annotator {
  const docs = new DocStore(doc);
  const store = createToolStore(settings);
  const view = new CanvasView(container, size.width, size.height, docs, () => store.get(), {
    onPickColor: (hex, copy) => {
      if (copy) void window.anyshot.invoke('clipboard:text', hex);
      else store.set({ color: hex });
    },
    onStateChange: () =>
      store.set({
        canUndo: docs.canUndo,
        canRedo: docs.canRedo,
        selectedCount: docs.selected.size,
        effects: docs.doc.effects,
      }),
  });
  store.set({ effects: doc.effects });
  const stopPersisting = persistToolChoices(store);
  // Every tool popover closes on a press outside it and on Esc.
  const stopDismissing = dismissPopovers(store);
  // A slider preview is committed on release. If its popover closes first (Esc, another
  // tool, another popover), drop the preview so the screen matches what will be exported.
  let popover = store.get().popover;
  const stopWatchingPopover = store.subscribe((s) => {
    if (s.popover === popover) return;
    popover = s.popover;
    if (s.previewEffects) {
      view.preview(null);
      store.set({ previewEffects: null });
    }
  });

  const controller: Controller = {
    store,
    setTool(tool: ToolId) {
      view.commitText();
      store.set({ tool, popover: null });
      if (tool !== 'select') docs.select([]);
    },
    setOptions(patch: Partial<ToolOptions>) {
      store.set(patch);
      const { color, strokeWidth, lineStyle, fill } = patch;
      const style = Object.fromEntries(
        Object.entries({ color, strokeWidth, lineStyle, fill }).filter(([, v]) => v !== undefined),
      );
      if (docs.selected.size > 0 && Object.keys(style).length > 0) view.applyStyle(style);
    },
    effects: {
      set: (effects) => {
        view.preview(null);
        store.set({ previewEffects: null });
        if (effects !== docs.doc.effects) docs.setEffects(effects);
      },
      preview: (effects) => {
        view.preview(effects);
        store.set({ previewEffects: effects });
      },
    },
    undo: () => docs.undo(),
    redo: () => docs.redo(),
  };

  function handleKey(e: KeyboardEvent): boolean {
    if (nativeInputOwnsKey(e)) return false;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      if (e.shiftKey) docs.redo();
      else docs.undo();
      return true;
    }
    if (mod && key === 'y') {
      docs.redo();
      return true;
    }
    if (view.keyDown(e)) return true;
    if (!mod && !e.altKey) {
      const tool = TOOL_KEYS[key];
      if (tool && store.get().enabledTools.includes(tool)) {
        controller.setTool(tool);
        return true;
      }
    }
    return false;
  }

  return {
    docs,
    view,
    controller,
    handleKey,
    dispose() {
      stopPersisting();
      stopDismissing();
      stopWatchingPopover();
      view.dispose();
    },
  };
}
