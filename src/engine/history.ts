import type { Rect } from '../shared/geometry';
import type { Annotation, Doc, Effects } from './model';

/** One undoable edit. Undo/redo is a list of these, each with an exact inverse. */
export type Change =
  | { type: 'add'; annotation: Annotation; index: number }
  | { type: 'remove'; annotation: Annotation; index: number }
  | { type: 'update'; before: Annotation; after: Annotation }
  | { type: 'effects'; before: Effects; after: Effects }
  | { type: 'crop'; before: Rect | null; after: Rect | null }
  | { type: 'batch'; changes: Change[] };

export function invert(change: Change): Change {
  switch (change.type) {
    case 'add':
      return { type: 'remove', annotation: change.annotation, index: change.index };
    case 'remove':
      return { type: 'add', annotation: change.annotation, index: change.index };
    case 'update':
      return { type: 'update', before: change.after, after: change.before };
    case 'effects':
      return { type: 'effects', before: change.after, after: change.before };
    case 'crop':
      return { type: 'crop', before: change.after, after: change.before };
    case 'batch':
      return { type: 'batch', changes: change.changes.map(invert).reverse() };
  }
}

/** Applies a change and returns a new document; the input is never mutated. */
export function apply(doc: Doc, change: Change): Doc {
  switch (change.type) {
    case 'add': {
      const annotations = doc.annotations.slice();
      annotations.splice(Math.min(change.index, annotations.length), 0, change.annotation);
      return { ...doc, annotations };
    }
    case 'remove':
      return { ...doc, annotations: doc.annotations.filter((a) => a.id !== change.annotation.id) };
    case 'update':
      return {
        ...doc,
        annotations: doc.annotations.map((a) => (a.id === change.after.id ? change.after : a)),
      };
    case 'effects':
      return { ...doc, effects: change.after };
    case 'crop':
      return { ...doc, crop: change.after };
    case 'batch':
      return change.changes.reduce(apply, doc);
  }
}

export class History {
  private undoStack: Change[] = [];
  private redoStack: Change[] = [];

  constructor(private readonly limit = 500) {}

  push(change: Change): void {
    this.undoStack.push(change);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Returns the change to apply to undo the last edit, if any. */
  undo(): Change | undefined {
    const change = this.undoStack.pop();
    if (!change) return undefined;
    this.redoStack.push(change);
    return invert(change);
  }

  redo(): Change | undefined {
    const change = this.redoStack.pop();
    if (!change) return undefined;
    this.undoStack.push(change);
    return change;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
