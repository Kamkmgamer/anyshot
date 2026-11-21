/*
  A scripted anyshot demo, played over a mock code editor. The window is laid out
  at 960 × 600 and scaled to fit its host, so scenes use plain pixel coordinates
  measured from the live DOM.
*/
import './demo.css';
import { EDITOR, TERMINAL_IDLE } from './editor';
import { captureName, ICONS, must } from './icons';

export type Scene = 'capture' | 'record' | 'ocr' | 'pin' | 'beautify';
export const SCENES: Scene[] = ['capture', 'record', 'ocr', 'pin', 'beautify'];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface DemoOptions {
  onScene?: (name: Scene) => void;
  onDone?: (name: Scene) => void;
}
export interface Demo {
  play(name: Scene): Promise<void>;
  stop(): void;
  readonly playing: Scene | null;
}

const W = 960;
const H = 600;
const RED = '#F04438';
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Thrown inside a scene when it's been replaced or stopped. */
class Stopped extends Error {}

const HANDLES = ['0,0', '50%,0', '100%,0', '0,50%', '100%,50%', '0,100%', '50%,100%', '100%,100%']
  .map((p) => {
    const [l, t] = p.split(',');
    return `<i style="left:${l};top:${t}"></i>`;
  })
  .join('');

const WINDOW = `<div class="dm-scale"><div class="dm-win" aria-hidden="true">
  <div class="dm-tb"><span class="logo"></span><div class="menu"><span>File</span><span>Edit</span><span>Selection</span><span>View</span><span>Go</span><span>Terminal</span></div><span class="title">beautify.ts — anyshot</span><div class="ctl"><i>${ICONS.minimize}</i><i>${ICONS.maximize}</i><i>${ICONS.close}</i></div></div>
  <div class="dm-body">${EDITOR}</div>
  <div class="dm-layer">
    <div class="dm-dim"></div>
    <div class="dm-sel">${HANDLES}<span class="dm-chip"></span></div>
    <svg class="dm-ink" viewBox="0 0 ${W} ${H}"></svg>
    <div class="dm-bar dm-tools"><i class="on" data-t="arrow">${ICONS.arrow}</i><i data-t="rect">${ICONS.rect}</i><i>${ICONS.pen}</i><i>${ICONS.text}</i><i data-t="badge">${ICONS.badge}</i><i>${ICONS.censor}</i><span class="sep"></span><i><span class="dm-sw"></span></i><i>${ICONS.undo}</i></div>
    <div class="dm-bar v dm-acts"><i>${ICONS.close}</i><span class="sep"></span><i data-a="copy">${ICONS.copy}</i><i>${ICONS.save}</i><i data-a="pin">${ICONS.pin}</i></div>
    <div class="dm-rec"><span class="dot"></span><span class="t">0:00</span><i class="on">${ICONS.mic}</i><span class="stop"></span></div>
    <div class="dm-ocr"><h5>Copied text <span>English</span></h5><p></p></div>
    <div class="dm-thumb"><div class="acts"><span>Edit</span><span class="p">Copy</span><span>Save</span></div></div>
    <div class="dm-keys"></div>
    <div class="dm-toast"><b>${ICONS.check}</b><span></span></div>
  </div>
  <div class="dm-cursor"><svg viewBox="0 0 22 22" width="22" height="22"><path d="M4 2l13 8.5-6 1.4-2.8 6.1z" fill="#101A33" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg><span class="ring"></span></div>
</div></div>`;

export function mountDemo(host: HTMLElement, opts: DemoOptions = {}): Demo {
  host.classList.add('dm');
  host.innerHTML = WINDOW;
  const scale = must(host, '.dm-scale');
  const win = must(host, '.dm-win');
  const q = <T extends Element = HTMLElement>(s: string) => must<T>(win, s);

  let k = 1;
  const fit = () => {
    k = host.clientWidth / W || 1;
    scale.style.transform = `scale(${k})`;
    host.style.height = `${H * k}px`;
  };
  new ResizeObserver(fit).observe(host);
  fit();

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let token = 0;
  const live = (t: number) => {
    if (t !== token) throw new Stopped();
  };
  const wait = (ms: number, t: number) =>
    new Promise<void>((resolve, reject) =>
      setTimeout(() => (t === token ? resolve() : reject(new Stopped())), ms),
    );
  const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
  const tween = (ms: number, fn: (e: number) => void, t: number) =>
    new Promise<void>((resolve, reject) => {
      const start = performance.now();
      const step = (now: number) => {
        if (t !== token) return reject(new Stopped());
        const p = reduce ? 1 : Math.min(1, (now - start) / ms);
        fn(ease(p));
        if (p < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  const rectOf = (el: Element, grow = 0): Box => {
    const r = el.getBoundingClientRect();
    const w = win.getBoundingClientRect();
    return {
      x: (r.left - w.left) / k - grow,
      y: (r.top - w.top) / k - grow,
      w: r.width / k + grow * 2,
      h: r.height / k + grow * 2,
    };
  };
  const px = (el: HTMLElement, b: Partial<Box>) => {
    if (b.x !== undefined) el.style.left = `${b.x}px`;
    if (b.y !== undefined) el.style.top = `${b.y}px`;
    if (b.w !== undefined) el.style.width = `${b.w}px`;
    if (b.h !== undefined) el.style.height = `${b.h}px`;
  };

  const cur = q('.dm-cursor');
  const sel = q('.dm-sel');
  const chip = q('.dm-chip');
  const dim = q('.dm-dim');
  const ink = q<SVGSVGElement>('.dm-ink');
  const tools = q('.dm-tools');
  const acts = q('.dm-acts');
  const keysEl = q('.dm-keys');
  const toastEl = q('.dm-toast');
  const thumb = q('.dm-thumb');
  const rec = q('.dm-rec');
  const ocr = q('.dm-ocr');

  let cx = 760;
  let cy = 520;
  const placeCur = () => {
    cur.style.transform = `translate(${cx}px, ${cy}px)`;
  };
  async function moveTo(x: number, y: number, ms: number, t: number) {
    const x0 = cx;
    const y0 = cy;
    cur.classList.add('on');
    await tween(
      ms,
      (e) => {
        cx = x0 + (x - x0) * e;
        cy = y0 + (y - y0) * e;
        placeCur();
      },
      t,
    );
  }
  function press() {
    cur.classList.remove('press');
    void cur.offsetWidth;
    cur.classList.add('press');
  }
  async function keys(list: string[], t: number, hold = 900) {
    keysEl.innerHTML = list.map((x) => `<kbd>${x}</kbd>`).join('');
    keysEl.classList.add('on');
    await wait(hold, t);
    keysEl.classList.remove('on');
  }
  function setSel(r: Box) {
    sel.style.display = 'block';
    px(sel, r);
    chip.textContent = `${Math.round(r.w * 2)} × ${Math.round(r.h * 2)}`;
  }
  async function drag(r: Box, t: number, ms = 750) {
    await moveTo(r.x, r.y, 600, t);
    press();
    dim.classList.add('cut');
    await tween(
      ms,
      (e) => {
        const w = Math.max(1, r.w * e);
        const h = Math.max(1, r.h * e);
        setSel({ x: r.x, y: r.y, w, h });
        cx = r.x + w;
        cy = r.y + h;
        placeCur();
      },
      t,
    );
  }
  function bars(r: Box | null) {
    tools.style.display = r ? 'flex' : 'none';
    acts.style.display = r ? 'flex' : 'none';
    if (!r) return;
    let ty = r.y + r.h + 10;
    if (ty + 40 > H - 8) ty = r.y - 46;
    px(tools, { x: Math.min(r.x, W - 300), y: ty });
    let ax = r.x + r.w + 10;
    if (ax + 40 > W - 8) ax = r.x - 46;
    px(acts, { x: ax, y: r.y });
  }
  async function toast(text: string, t: number, ms = 1800) {
    must(toastEl, 'span').textContent = text;
    toastEl.classList.add('on');
    await wait(ms, t);
    toastEl.classList.remove('on');
  }
  /** A picture of part of the window: a scaled clone of the editor and any annotations. */
  function shot(r: Box, maxW: number, maxH: number): HTMLElement {
    const s = Math.min(maxW / r.w, maxH / r.h);
    const box = document.createElement('div');
    box.className = 'dm-shot';
    px(box, { w: r.w * s, h: r.h * s });
    const inner = document.createElement('div');
    const body = q('.dm-body').cloneNode(true) as HTMLElement;
    Object.assign(body.style, {
      position: 'absolute',
      left: '0',
      top: '40px',
      width: `${W}px`,
      height: `${H - 40}px`,
    });
    px(inner, { w: W, h: H });
    inner.style.transform = `scale(${s}) translate(${-r.x}px, ${-r.y}px)`;
    inner.appendChild(body);
    if (ink.childElementCount) {
      const copy = ink.cloneNode(true) as SVGSVGElement;
      copy.setAttribute('style', `position:absolute;inset:0;width:${W}px;height:${H}px`);
      inner.appendChild(copy);
    }
    box.appendChild(inner);
    return box;
  }
  function clearAll() {
    dim.classList.remove('on', 'cut');
    sel.style.display = 'none';
    bars(null);
    ink.replaceChildren();
    keysEl.classList.remove('on');
    toastEl.classList.remove('on');
    rec.style.display = 'none';
    ocr.style.display = 'none';
    thumb.classList.remove('on', 'hover');
    thumb.querySelector('.dm-shot')?.remove();
    for (const n of win.querySelectorAll('.dm-pin, .dm-beauty')) n.remove();
    q('.e-cmd').textContent = '';
    q('.e-out').innerHTML = TERMINAL_IDLE;
    for (const i of tools.querySelectorAll<HTMLElement>('i')) {
      i.classList.toggle('on', i.dataset.t === 'arrow');
    }
    cur.classList.remove('on');
  }
  async function open(list: string[], t: number) {
    await keys(list, t, 700);
    dim.classList.add('on');
    await wait(250, t);
  }
  async function close(t: number) {
    dim.classList.remove('on', 'cut');
    sel.style.display = 'none';
    bars(null);
    await wait(200, t);
  }
  function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, String(v));
    ink.appendChild(e);
    return e;
  }
  async function clickTool(name: string, t: number) {
    const b = must(tools, `[data-t="${name}"]`);
    const r = rectOf(b);
    await moveTo(r.x + r.w / 2, r.y + r.h / 2, 420, t);
    press();
    for (const i of tools.querySelectorAll('i')) i.classList.toggle('on', i === b);
    await wait(160, t);
  }

  const line = (n: number) => q(`[data-l="${n}"]`);
  const lineText = (n: number) => must(line(n), 'span');
  /** Whole code lines a to b, `w` pixels wide from the line numbers. */
  function lines(a: number, b: number, w: number, grow = 6): Box {
    const r1 = rectOf(line(a));
    const r2 = rectOf(line(b));
    return { x: r1.x - grow, y: r1.y + 1, w: w + grow * 2, h: r2.y + r2.h - r1.y - 1 };
  }

  const scenes: Record<Scene, (t: number) => Promise<void>> = {
    async capture(t) {
      const r = lines(4, 14, 470);
      await open(['Alt', 'Shift', 'X'], t);
      await drag(r, t);
      bars(r);
      await wait(250, t);
      const target = rectOf(lineText(9));
      const a = { x: r.x + r.w - 40, y: r.y + r.h - 30 };
      const b = { x: target.x + target.w + 14, y: target.y + target.h / 2 + 2 };
      await moveTo(a.x, a.y, 500, t);
      press();
      const path = svgEl('path', {
        stroke: RED,
        'stroke-width': 4,
        'stroke-linecap': 'round',
        fill: 'none',
      });
      const head = svgEl('path', { fill: RED, opacity: 0 });
      await tween(
        500,
        (e) => {
          cx = a.x + (b.x - a.x) * e;
          cy = a.y + (b.y - a.y) * e;
          placeCur();
          path.setAttribute('d', `M${a.x} ${a.y}L${cx} ${cy}`);
        },
        t,
      );
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const hl = 18;
      head.setAttribute(
        'd',
        `M${b.x} ${b.y}L${b.x - hl * Math.cos(ang - 0.45)} ${b.y - hl * Math.sin(ang - 0.45)}L${b.x - hl * Math.cos(ang + 0.45)} ${b.y - hl * Math.sin(ang + 0.45)}Z`,
      );
      head.setAttribute('opacity', '1');

      await clickTool('rect', t);
      const lr = rectOf(lineText(9));
      const box = { x: lr.x + 8, y: lr.y - 2, w: lr.w - 4, h: lr.h + 4 };
      await moveTo(box.x, box.y, 400, t);
      press();
      const rc = svgEl('rect', {
        x: box.x,
        y: box.y,
        rx: 3,
        fill: 'none',
        stroke: RED,
        'stroke-width': 3,
      });
      await tween(
        450,
        (e) => {
          rc.setAttribute('width', String(box.w * e));
          rc.setAttribute('height', String(box.h * e));
          cx = box.x + box.w * e;
          cy = box.y + box.h * e;
          placeCur();
        },
        t,
      );

      await clickTool('badge', t);
      const bx = box.x - 4;
      const by = box.y - 2;
      await moveTo(bx, by, 400, t);
      press();
      svgEl('circle', { cx: bx, cy: by, r: 11, fill: RED });
      const n = svgEl('text', {
        x: bx,
        y: by + 4.5,
        'text-anchor': 'middle',
        fill: '#fff',
        'font-size': 12,
        'font-weight': 700,
        'font-family': 'Geist Variable, sans-serif',
      });
      n.textContent = '1';
      await wait(500, t);

      await keys(['Ctrl', 'C'], t, 650);
      thumb.prepend(shot(r, 230, 140));
      await close(t);
      ink.replaceChildren();
      toast(`Copied ${Math.round(r.w * 2)} × ${Math.round(r.h * 2)} to the clipboard`, t).catch(
        () => {},
      );
      thumb.classList.add('on');
      await wait(900, t);
      const tr = rectOf(thumb);
      await moveTo(tr.x + tr.w * 0.6, tr.y + tr.h * 0.55, 500, t);
      thumb.classList.add('hover');
      await wait(1500, t);
    },

    async record(t) {
      const r = rectOf(q('.e-panel'));
      await open(['Alt', 'Shift', 'R'], t);
      await drag(r, t, 650);
      rec.style.display = 'flex';
      px(rec, { x: r.x, y: r.y - 40 });
      let secs = 0;
      const timer = setInterval(() => {
        secs++;
        must(rec, '.t').textContent = `0:${String(secs).padStart(2, '0')}`;
      }, 700);
      try {
        const cmd = q('.e-cmd');
        const cr = rectOf(cmd);
        await moveTo(cr.x + 40, cr.y + 30, 500, t);
        for (const ch of 'bun run test') {
          live(t);
          cmd.textContent += ch;
          await wait(reduce ? 0 : 60, t);
        }
        await wait(300, t);
        const out = q('.e-out');
        out.innerHTML = '<div><span class="p">PS C:\\dev\\anyshot&gt;</span> bun run test</div>';
        cmd.textContent = '';
        const output = [
          '<span class="dim">RUN  v5.1.1 C:/dev/anyshot</span>',
          '<span class="ok">✓</span> tests/unit/beautify.test.ts',
          '<span class="ok">✓</span> tests/unit/filename.test.ts',
          '<span class="ok">✓</span> tests/unit/history.test.ts',
          '<span class="ok">✓</span> tests/unit/selection.test.ts',
          '<span class="ok">Test Files  4 passed (4)</span>',
        ];
        for (const l of output) {
          live(t);
          out.insertAdjacentHTML('beforeend', `<div>${l}</div>`);
          while (out.children.length > 5) out.firstChild?.remove();
          await wait(reduce ? 0 : 380, t);
        }
        await wait(600, t);
      } finally {
        clearInterval(timer);
      }
      await keys(['Alt', 'Shift', 'R'], t, 650);
      rec.style.display = 'none';
      await close(t);
      await toast(`Saved ${captureName('mp4', true)}`, t, 2200);
    },

    async ocr(t) {
      const r = rectOf(lineText(5), 6);
      await open(['Alt', 'Shift', 'T'], t);
      await drag(r, t, 600);
      await wait(300, t);
      const out = must(ocr, 'p');
      out.textContent = '';
      ocr.style.display = 'block';
      ocr.style.width = '360px';
      px(ocr, { x: Math.min(r.x, W - 380), y: r.y + r.h + 14 });
      const text = lineText(5).textContent ?? '';
      for (let i = 1; i <= text.length; i++) {
        live(t);
        out.textContent = text.slice(0, i);
        await wait(reduce ? 0 : 18, t);
      }
      await wait(600, t);
      await close(t);
      ocr.style.display = 'none';
      ocr.style.width = '';
      await toast('Copied 1 line of text', t);
    },

    async pin(t) {
      const r = lines(5, 14, 250, 8);
      await open(['Alt', 'Shift', 'X'], t);
      await drag(r, t, 600);
      bars(r);
      await wait(300, t);
      const pb = rectOf(must(acts, '[data-a="pin"]'));
      await moveTo(pb.x + pb.w / 2, pb.y + pb.h / 2, 450, t);
      press();
      await wait(200, t);
      await close(t);
      const pin = document.createElement('div');
      pin.className = 'dm-pin';
      const s = shot(r, r.w, r.h);
      pin.appendChild(s);
      pin.insertAdjacentHTML('beforeend', '<span class="dm-zoom">100%</span>');
      px(pin, { x: r.x, y: r.y });
      q('.dm-layer').appendChild(pin);
      await moveTo(r.x + 40, r.y + 30, 300, t);
      press();
      const tx = 560;
      const ty = 96;
      await tween(
        800,
        (e) => {
          const x = r.x + (tx - r.x) * e;
          const y = r.y + (ty - r.y) * e;
          px(pin, { x, y });
          cx = x + 40;
          cy = y + 30;
          placeCur();
        },
        t,
      );
      await wait(300, t);
      const inner = s.firstElementChild as HTMLElement;
      const base = inner.style.transform;
      const zoom = must(pin, '.dm-zoom');
      await tween(
        600,
        (e) => {
          const z = 1 + 0.25 * e;
          px(s, { w: r.w * z, h: r.h * z });
          inner.style.transform = base.replace(/scale\([^)]*\)/, `scale(${z})`);
          zoom.textContent = `${Math.round(z * 100)}%`;
        },
        t,
      );
      await toast('Pinned above every window', t, 2000);
    },

    async beautify(t) {
      const r = lines(4, 14, 440, 8);
      await open(['Alt', 'Shift', 'X'], t);
      await drag(r, t, 600);
      bars(r);
      await wait(350, t);
      await close(t);
      const b = document.createElement('div');
      b.className = 'dm-beauty';
      const s = shot(r, r.w * 1.2, r.h * 1.2);
      b.appendChild(s);
      b.insertAdjacentHTML('beforeend', '<span class="lab">Beautify</span>');
      q('.dm-layer').appendChild(b);
      dim.classList.add('on');
      await wait(30, t);
      b.classList.add('on');
      await tween(
        900,
        (e) => {
          b.style.padding = `${30 * e}px`;
          b.style.borderRadius = `${6 * e}px`;
          s.style.borderRadius = `${12 * e}px`;
          s.style.boxShadow = `0 ${14 * e}px ${34 * e}px rgba(16,26,51,${0.35 * e})`;
        },
        t,
      );
      await wait(600, t);
      await keys(['Ctrl', 'C'], t, 600);
      await toast('Copied with a background, padding and a shadow', t, 2000);
    },
  };

  let playing: Scene | null = null;
  async function play(name: Scene) {
    const t = ++token;
    clearAll();
    cx = 760;
    cy = 520;
    placeCur();
    playing = name;
    opts.onScene?.(name);
    try {
      await scenes[name](t);
      await wait(400, t);
      clearAll();
      playing = null;
      opts.onDone?.(name);
    } catch (e) {
      if (!(e instanceof Stopped)) throw e;
    }
  }
  function stop() {
    token++;
    clearAll();
    playing = null;
  }
  return {
    play,
    stop,
    get playing() {
      return playing;
    },
  };
}
