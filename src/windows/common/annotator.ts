import { DocStore } from '../../engine/document';
import type { Doc } from '../../engine/model';
import { CanvasView, type ToolOptions } from '../../engine/view';
import type { Settings, ToolId } from '../../shared/settings';
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
      }),
  });
  const stopPersisting = persistToolChoices(store);

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
    undo: () => docs.undo(),
    redo: () => docs.redo(),
  };

  function handleKey(e: KeyboardEvent): boolean {
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
      view.dispose();
    },
  };
}
