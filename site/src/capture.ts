/*
  anyshot's capture overlay, on the landing page itself. Drag on any element marked
  [data-capture-surface], or press Alt+Shift+X, and the page behaves like anyshot:
  dim, select with eight handles, annotate, then copy, save or pin a real PNG.
*/
import './capture.css';
import { captureName, ICONS, must } from './icons';

interface Point {
  x: number;
  y: number;
}
interface Box extends Point {
  w: number;
  h: number;
}
type Tool = 'arrow' | 'rect' | 'pen' | 'badge' | 'censor';
type Shape =
  | { t: 'arrow' | 'rect' | 'censor'; a: Point; b: Point; c: string }
  | { t: 'pen'; pts: Point[]; c: string }
  | { t: 'badge'; a: Point; c: string; n: number };
type Drag =
  | { kind: 'select'; o: Point }
  | { kind: 'resize'; h: string; s0: Box }
  | { kind: 'draw'; sh: Shape };
type Finish = 'copy' | 'save' | 'pin';

export interface CaptureOptions {
  colours: string[];
  /** Runs when a capture opens, for example to stop a demo that's playing. */
  onOpen?: () => void;
}

const TOOL_KEYS: Record<string, Tool> = {
  a: 'arrow',
  r: 'rect',
  p: 'pen',
  n: 'badge',
  b: 'censor',
};
const NOT_A_SURFACE = 'a, button, input, select, label, summary, p, h1, h2, kbd, [data-no-capture]';

const norm = (a: Point, b: Point): Box => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y),
});
const inside = (p: Point, r: Box | null): boolean =>
  !!r && p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;

const isLight = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 160;
};

export function initCapture(opts: CaptureOptions) {
  const colours = opts.colours;
  const handles = [
    'nw:0:0',
    'n:50%:0',
    'ne:100%:0',
    'w:0:50%',
    'e:100%:50%',
    'sw:0:100%',
    's:50%:100%',
    'se:100%:100%',
  ]
    .map((s) => {
      const [h, l, t] = s.split(':');
      return `<i class="ac-h" data-h="${h}" style="left:${l};top:${t}"></i>`;
    })
    .join('');

  const root = document.createElement('div');
  root.className = 'ac-root';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Capture');
  root.innerHTML = `
    <div class="ac-shade" hidden></div><div class="ac-censors"></div><canvas class="ac-ink"></canvas>
    <div class="ac-frame" hidden><span class="ac-chip">0 × 0</span>${handles}</div>
    <div class="ac-bar ac-tools" hidden role="toolbar" aria-label="Annotation tools">
      <button type="button" data-tool="arrow" aria-pressed="true" aria-label="Arrow (A)" title="Arrow (A)">${ICONS.arrow}</button>
      <button type="button" data-tool="rect" aria-pressed="false" aria-label="Rectangle (R)" title="Rectangle (R)">${ICONS.rect}</button>
      <button type="button" data-tool="pen" aria-pressed="false" aria-label="Pencil (P)" title="Pencil (P)">${ICONS.pen}</button>
      <button type="button" data-tool="badge" aria-pressed="false" aria-label="Numbered badge (N)" title="Numbered badge (N)">${ICONS.badge}</button>
      <button type="button" data-tool="censor" aria-pressed="false" aria-label="Censor (B)" title="Censor (B)">${ICONS.censor}</button>
      <span class="ac-sep"></span>
      <button type="button" data-act="colour" aria-label="Change colour" title="Colour"><span class="ac-sw"></span></button>
      <button type="button" data-act="undo" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)">${ICONS.undo}</button>
    </div>
    <div class="ac-bar ac-v ac-acts" hidden role="toolbar" aria-label="Finish">
      <button type="button" data-act="close" aria-label="Cancel (Esc)" title="Cancel (Esc)">${ICONS.close}</button>
      <span class="ac-sep"></span>
      <button type="button" data-act="copy" aria-label="Copy (Ctrl+C)" title="Copy (Ctrl+C)">${ICONS.copy}</button>
      <button type="button" data-act="save" aria-label="Save (Ctrl+S)" title="Save (Ctrl+S)">${ICONS.save}</button>
      <button type="button" data-act="pin" aria-label="Pin (F)" title="Pin (F)">${ICONS.pin}</button>
    </div>
    <div class="ac-hint">Drag to select an area. Esc cancels.</div>`;
  document.body.appendChild(root);

  const toastEl = document.createElement('div');
  toastEl.className = 'ac-toast';
  toastEl.setAttribute('role', 'status');
  toastEl.setAttribute('aria-live', 'polite');
  document.body.appendChild(toastEl);

  const shade = must(root, '.ac-shade');
  const frame = must(root, '.ac-frame');
  const chip = must(root, '.ac-chip');
  const tools = must(root, '.ac-tools');
  const acts = must(root, '.ac-acts');
  const hint = must(root, '.ac-hint');
  const censors = must(root, '.ac-censors');
  const swatch = must(root, '.ac-sw');
  const ink = must<HTMLCanvasElement>(root, '.ac-ink');
  const ctx = ink.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');

  let on = false;
  let sel: Box | null = null;
  let drag: Drag | null = null;
  let tool: Tool = 'arrow';
  let colour = 0;
  let shapes: Shape[] = [];
  let lastFocus: Element | null = null;
  swatch.style.background = colours[0] ?? '#f04438';

  function open(x?: number, y?: number, pointerId?: number) {
    if (on) return;
    on = true;
    sel = null;
    shapes = [];
    lastFocus = document.activeElement;
    document.documentElement.style.overflow = 'hidden';
    root.hidden = false;
    sizeInk();
    layout();
    opts.onOpen?.();
    void loadH2C().catch(() => {});
    if (x !== undefined && y !== undefined) {
      begin(x, y);
      if (pointerId !== undefined) {
        try {
          root.setPointerCapture(pointerId);
        } catch {
          // The pointer was already released; the next press starts a selection.
        }
      }
    }
  }
  function close() {
    if (!on) return;
    on = false;
    root.hidden = true;
    document.documentElement.style.overflow = '';
    if (lastFocus instanceof HTMLElement) lastFocus.focus({ preventScroll: true });
  }
  function sizeInk() {
    const d = devicePixelRatio || 1;
    ink.width = innerWidth * d;
    ink.height = innerHeight * d;
    ctx?.setTransform(d, 0, 0, d, 0, 0);
  }
  addEventListener('resize', () => {
    if (on) {
      sizeInk();
      layout();
    }
  });

  function place(el: HTMLElement, b: Box) {
    Object.assign(el.style, {
      left: `${b.x}px`,
      top: `${b.y}px`,
      width: `${b.w}px`,
      height: `${b.h}px`,
    });
  }

  function layout() {
    const s = sel;
    const has = !!s && s.w > 2 && s.h > 2;
    root.classList.toggle('ac-empty', !has);
    shade.hidden = !has;
    frame.hidden = !has;
    const ready = has && drag?.kind !== 'select';
    tools.hidden = !ready;
    acts.hidden = !ready;
    hint.hidden = has;
    if (s && has) {
      place(shade, s);
      place(frame, s);
      const d = devicePixelRatio || 1;
      chip.textContent = `${Math.round(s.w * d)} × ${Math.round(s.h * d)}`;
      chip.classList.toggle('inside', s.y < 36);
    }
    if (s && ready) {
      const tw = tools.offsetWidth;
      const th = tools.offsetHeight;
      const aw = acts.offsetWidth;
      const ah = acts.offsetHeight;
      const tx = Math.min(Math.max(8, s.x), innerWidth - tw - 8);
      let ty = s.y + s.h + 12;
      if (ty + th > innerHeight - 8) ty = s.y - th - 12;
      if (ty < 8) ty = s.y + s.h - th - 10;
      tools.style.left = `${tx}px`;
      tools.style.top = `${ty}px`;
      let ax = s.x + s.w + 12;
      const ay = Math.max(8, Math.min(s.y, innerHeight - ah - 8));
      if (ax + aw > innerWidth - 8) ax = s.x - aw - 12;
      if (ax < 8) ax = s.x + s.w - aw - 10;
      acts.style.left = `${ax}px`;
      acts.style.top = `${ay}px`;
    }
    render();
  }

  function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    censors.replaceChildren();
    const s = sel;
    if (!s) return;
    for (const sh of shapes) {
      if (sh.t !== 'censor') continue;
      const r = norm(sh.a, sh.b);
      const x = Math.max(r.x, s.x);
      const y = Math.max(r.y, s.y);
      const w = Math.min(r.x + r.w, s.x + s.w) - x;
      const h = Math.min(r.y + r.h, s.y + s.h) - y;
      if (w <= 0 || h <= 0) continue;
      const div = document.createElement('div');
      place(div, { x, y, w, h });
      censors.appendChild(div);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(s.x, s.y, s.w, s.h);
    ctx.clip();
    for (const sh of shapes) draw(ctx, sh);
    ctx.restore();
  }

  function draw(c: CanvasRenderingContext2D, sh: Shape) {
    c.strokeStyle = sh.c;
    c.fillStyle = sh.c;
    c.lineWidth = 4;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (sh.t === 'arrow') {
      const { a, b } = sh;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 2) return;
      const head = Math.min(22, len * 0.45);
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x - Math.cos(ang) * head * 0.6, b.y - Math.sin(ang) * head * 0.6);
      c.stroke();
      c.beginPath();
      c.moveTo(b.x, b.y);
      c.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45));
      c.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45));
      c.closePath();
      c.fill();
    } else if (sh.t === 'rect') {
      const r = norm(sh.a, sh.b);
      c.beginPath();
      c.roundRect(r.x, r.y, r.w, r.h, 3);
      c.stroke();
    } else if (sh.t === 'pen') {
      c.beginPath();
      for (const [i, p] of sh.pts.entries()) {
        if (i) c.lineTo(p.x, p.y);
        else c.moveTo(p.x, p.y);
      }
      c.stroke();
    } else if (sh.t === 'badge') {
      c.beginPath();
      c.arc(sh.a.x, sh.a.y, 15, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = isLight(sh.c) ? '#101a33' : '#fff';
      c.font = '700 15px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(sh.n), sh.a.x, sh.a.y + 1);
    }
  }

  function begin(x: number, y: number) {
    shapes = [];
    drag = { kind: 'select', o: { x, y } };
    sel = { x, y, w: 0, h: 0 };
    layout();
  }

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('.ac-bar')) return;
    const p = { x: e.clientX, y: e.clientY };
    root.setPointerCapture(e.pointerId);
    const handle = (e.target as Element).closest<HTMLElement>('.ac-h');
    if (handle && sel) {
      drag = { kind: 'resize', h: handle.dataset.h ?? '', s0: { ...sel } };
      return;
    }
    if (sel && inside(p, sel) && sel.w > 2) {
      const c = colours[colour] ?? '#f04438';
      if (tool === 'badge') {
        shapes.push({ t: 'badge', a: p, c, n: shapes.filter((s) => s.t === 'badge').length + 1 });
        render();
        return;
      }
      const sh: Shape = tool === 'pen' ? { t: 'pen', pts: [p], c } : { t: tool, a: p, b: p, c };
      shapes.push(sh);
      drag = { kind: 'draw', sh };
      return;
    }
    begin(p.x, p.y);
  });
  root.addEventListener('pointermove', (e) => {
    const d = drag;
    if (!d) return;
    const p = {
      x: Math.max(0, Math.min(innerWidth, e.clientX)),
      y: Math.max(0, Math.min(innerHeight, e.clientY)),
    };
    if (d.kind === 'select') {
      sel = norm(d.o, p);
      layout();
    } else if (d.kind === 'resize') {
      const s = d.s0;
      let x1 = s.x;
      let y1 = s.y;
      let x2 = s.x + s.w;
      let y2 = s.y + s.h;
      if (d.h.includes('w')) x1 = p.x;
      if (d.h.includes('e')) x2 = p.x;
      if (d.h.includes('n')) y1 = p.y;
      if (d.h.includes('s')) y2 = p.y;
      sel = norm({ x: x1, y: y1 }, { x: x2, y: y2 });
      layout();
    } else {
      if (d.sh.t === 'pen') d.sh.pts.push(p);
      else if (d.sh.t !== 'badge') d.sh.b = p;
      render();
    }
  });
  const end = () => {
    if (!drag) return;
    const kind = drag.kind;
    drag = null;
    if (kind === 'select' && sel && (sel.w < 6 || sel.h < 6)) sel = null;
    layout();
    if (kind === 'select' && sel)
      must(tools, '[aria-pressed="true"]').focus({ preventScroll: true });
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  function setTool(t: Tool) {
    tool = t;
    for (const b of tools.querySelectorAll<HTMLElement>('[data-tool]')) {
      b.setAttribute('aria-pressed', String(b.dataset.tool === t));
    }
  }
  root.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.tool) setTool(b.dataset.tool as Tool);
    const a = b.dataset.act;
    if (a === 'colour') {
      colour = (colour + 1) % colours.length;
      swatch.style.background = colours[colour] ?? '#f04438';
    } else if (a === 'undo') {
      shapes.pop();
      render();
    } else if (a === 'close') close();
    else if (a === 'copy' || a === 'save' || a === 'pin') void finish(a);
  });

  document.addEventListener('pointerdown', (e) => {
    const target = e.target as Element;
    if (on || e.button !== 0 || e.pointerType === 'touch') return;
    if (!target.closest('[data-capture-surface]') || target.closest(NOT_A_SURFACE)) return;
    e.preventDefault();
    open(e.clientX, e.clientY, e.pointerId);
  });
  addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyX') {
      e.preventDefault();
      open();
      return;
    }
    if (!on) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (sel && !shapes.length) {
        sel = null;
        layout();
      } else close();
    } else if (!sel) return;
    else if (mod && k === 'z') {
      e.preventDefault();
      shapes.pop();
      render();
    } else if (mod && k === 'c') {
      e.preventDefault();
      void finish('copy');
    } else if (mod && k === 's') {
      e.preventDefault();
      void finish('save');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void finish('copy');
    } else if (!mod && !e.altKey) {
      const t = TOOL_KEYS[k];
      if (t) setTool(t);
      else if (k === 'f') void finish('pin');
    }
  });

  async function rasterize(): Promise<HTMLCanvasElement> {
    const html2canvas = await loadH2C();
    const s = sel;
    if (!s) throw new Error('Select an area first.');
    const d = Math.min(2, devicePixelRatio || 1);
    root.style.visibility = 'hidden';
    try {
      const base = await html2canvas(document.body, {
        x: s.x + scrollX,
        y: s.y + scrollY,
        width: s.w,
        height: s.h,
        scale: d,
        logging: false,
        backgroundColor: getComputedStyle(document.documentElement).backgroundColor,
        ignoreElements: (el) => el === root || el === toastEl || el.classList.contains('ac-pin'),
      });
      const c = base.getContext('2d');
      if (!c) throw new Error('Canvas 2D is not available');
      // html2canvas leaves its own transform on the context.
      c.setTransform(1, 0, 0, 1, 0, 0);
      for (const sh of shapes) {
        if (sh.t !== 'censor') continue;
        const r = norm(sh.a, sh.b);
        const rx = (r.x - s.x) * d;
        const ry = (r.y - s.y) * d;
        const rw = r.w * d;
        const rh = r.h * d;
        if (rw < 1 || rh < 1) continue;
        const t = document.createElement('canvas');
        t.width = Math.max(1, rw / 14);
        t.height = Math.max(1, rh / 14);
        t.getContext('2d')?.drawImage(base, rx, ry, rw, rh, 0, 0, t.width, t.height);
        c.save();
        c.imageSmoothingEnabled = false;
        c.drawImage(t, 0, 0, t.width, t.height, rx, ry, rw, rh);
        c.restore();
      }
      c.save();
      c.scale(d, d);
      c.translate(-s.x, -s.y);
      for (const sh of shapes) draw(c, sh);
      c.restore();
      return base;
    } finally {
      root.style.visibility = '';
    }
  }
  const toBlob = (cv: HTMLCanvasElement) =>
    new Promise<Blob>((resolve, reject) => {
      cv.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Couldn't encode the image."))),
        'image/png',
      );
    });

  async function finish(kind: Finish) {
    const s = sel;
    if (!s) return;
    const d = devicePixelRatio || 1;
    const box = { ...s };
    const dims = `${Math.round(box.w * d)} × ${Math.round(box.h * d)}`;
    try {
      if (kind === 'copy') {
        if (!navigator.clipboard || !('ClipboardItem' in window)) {
          throw new Error("This browser can't put images on the clipboard. Use Save instead.");
        }
        // The promise keeps the click's permission while the image renders.
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': rasterize().then(toBlob) }),
        ]);
        close();
        toast(`Copied ${dims} to the clipboard`);
      } else if (kind === 'save') {
        const blob = await toBlob(await rasterize());
        const name = captureName('png');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        close();
        toast(`Saved ${name}`);
      } else {
        const cv = await rasterize();
        close();
        pin(cv.toDataURL('image/png'), box);
        toast('Pinned. Drag it anywhere, scroll to zoom.');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "That didn't work. Try again.");
    }
  }

  function pin(src: string, box: Box) {
    const el = document.createElement('div');
    el.className = 'ac-pin';
    el.innerHTML = `<img alt="Pinned capture" src="${src}"><button type="button" aria-label="Close pin">${ICONS.close}</button>`;
    let z = 1;
    let x = box.x;
    let y = box.y;
    const move = () => place(el, { x, y, w: box.w * z, h: box.h * z });
    move();
    document.body.appendChild(el);
    must(el, 'button').addEventListener('click', () => el.remove());
    el.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('button')) return;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
      const ox = e.clientX - x;
      const oy = e.clientY - y;
      const mv = (ev: PointerEvent) => {
        x = ev.clientX - ox;
        y = ev.clientY - oy;
        move();
      };
      el.addEventListener('pointermove', mv);
      el.addEventListener(
        'pointerup',
        () => {
          el.removeEventListener('pointermove', mv);
          el.style.cursor = '';
        },
        { once: true },
      );
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        z = Math.min(4, Math.max(0.25, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
        move();
      },
      { passive: false },
    );
    el.addEventListener('dblclick', () => el.remove());
  }

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function toast(message: string) {
    toastEl.textContent = message;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2800);
  }

  return { open, close };
}

type Html2Canvas = typeof import('html2canvas').default;
let h2c: Promise<Html2Canvas> | undefined;
/** html2canvas is only needed once someone captures, so it loads on demand. */
function loadH2C(): Promise<Html2Canvas> {
  h2c ??= import('html2canvas')
    .then((m) => m.default)
    .catch((e: unknown) => {
      h2c = undefined;
      throw e instanceof Error ? e : new Error("The capture code didn't load. Try again.");
    });
  return h2c;
}
