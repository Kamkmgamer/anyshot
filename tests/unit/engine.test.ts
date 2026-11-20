import { describe, expect, it } from 'vitest';
import { DocStore, parseDoc, translateDoc } from '../../src/engine/document';
import { apply, type Change, invert } from '../../src/engine/history';
import { type Annotation, emptyDoc, type Stroke } from '../../src/engine/model';
import {
  bounds,
  dragHandle,
  estimateTextWidth,
  handles,
  hitTest,
  textFont,
  topmostAt,
  translate,
} from '../../src/engine/shapes';
import { isMeaningful, restyle } from '../../src/engine/view';

const stroke: Stroke = { color: '#ff0000', width: 4, style: 'solid' };
const arrow: Annotation = {
  id: 'a1',
  kind: 'arrow',
  a: { x: 0, y: 0 },
  b: { x: 100, y: 0 },
  stroke,
};
const box: Annotation = {
  id: 'r1',
  kind: 'rect',
  rect: { x: 10, y: 10, width: 100, height: 50 },
  stroke,
  fill: 'stroke',
  radius: 0,
};
const filled: Annotation = { ...box, id: 'r2', fill: 'fill' };
const pencil: Annotation = {
  id: 'p1',
  kind: 'pencil',
  points: [
    { x: 0, y: 0 },
    { x: 50, y: 50 },
    { x: 100, y: 0 },
  ],
  stroke,
};
const ellipse: Annotation = { ...box, id: 'e1', kind: 'ellipse' };

describe('hit testing', () => {
  it('hits segments within stroke width plus tolerance', () => {
    expect(hitTest(arrow, { x: 50, y: 4 }, 3)).toBe(true);
    expect(hitTest(arrow, { x: 50, y: 10 }, 3)).toBe(false);
    expect(hitTest(arrow, { x: 110, y: 0 }, 3)).toBe(false);
  });

  it('hits outlined rectangles on the edge only, filled ones anywhere inside', () => {
    expect(hitTest(box, { x: 10, y: 30 }, 3)).toBe(true);
    expect(hitTest(box, { x: 60, y: 35 }, 3)).toBe(false);
    expect(hitTest(filled, { x: 60, y: 35 }, 3)).toBe(true);
  });

  it('hits ellipse outlines and freehand paths', () => {
    expect(hitTest(ellipse, { x: 60, y: 10 }, 3)).toBe(true);
    expect(hitTest(ellipse, { x: 60, y: 35 }, 3)).toBe(false);
    expect(hitTest(pencil, { x: 25, y: 25 }, 3)).toBe(true);
    expect(hitTest(pencil, { x: 50, y: 0 }, 3)).toBe(false);
  });

  it('returns the topmost annotation', () => {
    expect(topmostAt([filled, box], { x: 10, y: 30 }, 3)?.id).toBe('r1');
    expect(topmostAt([box, filled], { x: 60, y: 35 }, 3)?.id).toBe('r2');
    expect(topmostAt([box], { x: 500, y: 500 }, 3)).toBeUndefined();
  });
});

describe('geometry edits', () => {
  it('translates every kind without mutating the original', () => {
    const moved = translate(pencil, 5, -5);
    expect(bounds(moved)).toEqual({ x: 5, y: -5, width: 100, height: 50 });
    expect(bounds(pencil)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  it('drags handles, normalising rectangles', () => {
    expect(handles(arrow).map((h) => h.id)).toEqual(['a', 'b']);
    expect(dragHandle(arrow, 'b', { x: 0, y: 80 })).toMatchObject({ b: { x: 0, y: 80 } });
    const r = dragHandle(box, 'se', { x: 0, y: 0 });
    expect(r.kind === 'rect' && r.rect).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it('ignores accidental tiny drafts', () => {
    expect(isMeaningful({ ...arrow, b: { x: 1, y: 1 } }, 3)).toBe(false);
    expect(isMeaningful(arrow, 3)).toBe(true);
  });

  it('restyles only the properties that apply', () => {
    const r = restyle(box, { color: '#00ff00', strokeWidth: 2, fill: 'both' }, 2);
    expect(r).toMatchObject({
      stroke: { color: '#00ff00', width: 4, style: 'solid' },
      fill: 'both',
    });
    const s = restyle(
      { id: 's', kind: 'stamp', at: { x: 0, y: 0 }, emoji: '⭐', size: 10 },
      { color: '#000000' },
      1,
    );
    expect(s).toMatchObject({ kind: 'stamp', emoji: '⭐' });
  });
});

describe('change list', () => {
  it('every change has an exact inverse', () => {
    const start = { ...emptyDoc(), annotations: [box, arrow] };
    const changes: Change[] = [
      { type: 'add', annotation: pencil, index: 1 },
      { type: 'remove', annotation: arrow, index: 1 },
      { type: 'update', before: box, after: translate(box, 3, 3) },
      { type: 'crop', before: null, after: { x: 1, y: 2, width: 3, height: 4 } },
      {
        type: 'batch',
        changes: [
          { type: 'add', annotation: filled, index: 2 },
          { type: 'update', before: box, after: { ...box, fill: 'both' } },
        ],
      },
    ];
    for (const change of changes) {
      const after = apply(start, change);
      expect(after).not.toEqual(start);
      expect(apply(after, invert(change))).toEqual(start);
    }
  });

  it('inserts at the recorded index so undoing a delete restores order', () => {
    const doc = { ...emptyDoc(), annotations: [box, arrow, pencil] };
    const removed = apply(doc, { type: 'remove', annotation: arrow, index: 1 });
    expect(
      apply(removed, { type: 'add', annotation: arrow, index: 1 }).annotations.map((a) => a.id),
    ).toEqual(['r1', 'a1', 'p1']);
  });
});

describe('DocStore', () => {
  it('undoes and redoes, and a new edit clears redo', () => {
    const store = new DocStore();
    store.add(box);
    store.add(arrow);
    expect(store.doc.annotations).toHaveLength(2);
    expect(store.undo()).toBe(true);
    expect(store.doc.annotations.map((a) => a.id)).toEqual(['r1']);
    expect(store.canRedo).toBe(true);
    store.add(pencil);
    expect(store.canRedo).toBe(false);
    expect(store.redo()).toBe(false);
    store.undo();
    store.undo();
    expect(store.doc.annotations).toEqual([]);
    expect(store.undo()).toBe(false);
  });

  it('edits the selection as single undo steps', () => {
    const store = new DocStore();
    store.add(box);
    store.add(arrow);
    store.add(pencil);
    store.select(['r1', 'p1']);
    store.updateSelected((a) => translate(a, 10, 0));
    expect(bounds(store.find('r1') as Annotation).x).toBe(20);
    store.undo();
    expect(bounds(store.find('r1') as Annotation).x).toBe(10);
    store.removeSelected();
    expect(store.doc.annotations.map((a) => a.id)).toEqual(['a1']);
    expect(store.selected.size).toBe(0);
    store.undo();
    expect(store.doc.annotations.map((a) => a.id)).toEqual(['r1', 'a1', 'p1']);
  });

  it('duplicates and selects the copies', () => {
    const store = new DocStore();
    store.add(box);
    store.select(['r1']);
    let n = 0;
    store.duplicateSelected(12, () => `copy${++n}`);
    expect(store.doc.annotations.map((a) => a.id)).toEqual(['r1', 'copy1']);
    expect([...store.selected]).toEqual(['copy1']);
    expect(bounds(store.find('copy1') as Annotation)).toMatchObject({ x: 22, y: 22 });
  });

  it('notifies subscribers on every change', () => {
    const store = new DocStore();
    let calls = 0;
    store.subscribe(() => calls++);
    store.add(box);
    store.undo();
    store.redo();
    expect(calls).toBe(3);
  });
});

describe('serialisation', () => {
  it('round-trips a document through JSON', () => {
    const doc = {
      ...emptyDoc(2),
      annotations: [
        box,
        arrow,
        pencil,
        {
          id: 't',
          kind: 'text',
          at: { x: 1, y: 2 },
          text: 'Hi\nthere',
          size: 20,
          color: '#112233',
          background: true,
          style: { font: 'serif', bold: false, italic: true, underline: true, outline: false },
        },
        { id: 'n', kind: 'number', at: { x: 5, y: 5 }, value: 3, size: 30, color: '#ff0000' },
        { id: 'c', kind: 'censor', rect: { x: 0, y: 0, width: 5, height: 5 }, mode: 'blur' },
        { id: 's', kind: 'spotlight', rect: { x: 0, y: 0, width: 5, height: 5 }, dim: 0.5 },
        { id: 'm', kind: 'magnify', at: { x: 9, y: 9 }, radius: 40, zoom: 2, color: '#ffffff' },
        { id: 'st', kind: 'stamp', at: { x: 9, y: 9 }, emoji: '👍', size: 40 },
      ] as Annotation[],
      crop: { x: 1, y: 1, width: 10, height: 10 },
    };
    expect(parseDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('drops malformed annotations and clamps effects', () => {
    const parsed = parseDoc({
      unit: -1,
      annotations: [
        box,
        { id: 'x', kind: 'arrow', a: { x: 0 }, b: { x: 1, y: 1 }, stroke },
        {
          id: 'y',
          kind: 'rect',
          rect: box.kind === 'rect' ? box.rect : null,
          stroke: { ...stroke, color: 'red' },
          fill: 'stroke',
        },
        { id: 'z', kind: 'teleport' },
        'nonsense',
      ],
      effects: { invert: true, adjust: { contrast: 99 }, beautify: { enabled: true, padding: -5 } },
    });
    expect(parsed.annotations.map((a) => a.id)).toEqual(['r1']);
    expect(parsed.unit).toBe(1);
    expect(parsed.effects.invert).toBe(true);
    expect(parsed.effects.adjust.contrast).toBe(2);
    expect(parsed.effects.beautify).toMatchObject({ enabled: true, padding: 0 });
  });

  it('rejects sizes a canvas cannot draw and normalises rects', () => {
    const at = { x: 50, y: 50 };
    const parsed = parseDoc({
      annotations: [
        { id: 'm1', kind: 'magnify', at, radius: -1, zoom: 2, color: '#ffffff' },
        { id: 'm2', kind: 'magnify', at, radius: 40, zoom: 0, color: '#ffffff' },
        { id: 'n1', kind: 'number', at, value: 1, size: -4, color: '#ff0000' },
        { id: 't1', kind: 'text', at, text: 'x', size: 0, color: '#ff0000' },
        { id: 's1', kind: 'stamp', at, emoji: '👍', size: -1 },
        { ...ellipse, rect: { x: 50, y: 40, width: -20, height: -10 }, radius: -3 },
      ],
    });
    expect(parsed.annotations).toEqual([
      { ...ellipse, rect: { x: 30, y: 30, width: 20, height: 10 }, radius: 0 },
    ]);
  });

  it('translates a document into a region', () => {
    const doc = translateDoc({ ...emptyDoc(), annotations: [arrow] }, -10, -20);
    expect(doc.annotations[0]).toMatchObject({ a: { x: -10, y: -20 }, b: { x: 90, y: -20 } });
  });
});

describe('text metrics', () => {
  it('estimates width from the pixel size, not the font weight', () => {
    // 5 characters at 24px; reading the weight (600) instead would give 1740.
    expect(estimateTextWidth('hello', textFont(24))).toBeCloseTo(5 * 24 * 0.58);
  });
});
