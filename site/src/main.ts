import '@fontsource-variable/geist';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import './site.css';
import { initCapture } from './capture';
import { mountDemo, SCENES, type Scene } from './demo';
import { must } from './icons';
import { mountInstall } from './install';

mountInstall(must(document, '#install'));

const note = must(document, '#caps-note');
const sceneButtons = [...document.querySelectorAll<HTMLElement>('[data-scene]')];
const mark = (name: Scene | null) => {
  for (const b of sceneButtons) b.setAttribute('aria-pressed', String(b.dataset.scene === name));
};

const demo = mountDemo(must(document, '#demo'), {
  onScene: mark,
  onDone: () => {
    mark(null);
    note.innerHTML =
      'Now try the real thing: press <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>X</kbd> anywhere on this page';
  },
});
for (const b of sceneButtons) {
  const scene = b.dataset.scene as Scene;
  if (SCENES.includes(scene)) b.addEventListener('click', () => void demo.play(scene));
}

// A real capture of the page stops the demo, so the two never overlap.
initCapture({
  colours: ['#F04438', '#2F55E4', '#101A33', '#FFFFFF', '#E8A33D'],
  onOpen: () => demo.stop(),
});

/* The keycaps press in sequence, then the capture scene plays. */
const caps = [...document.querySelectorAll<HTMLElement>('.cap')];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let pressing = false;
async function pressAll() {
  if (pressing) return;
  pressing = true;
  note.textContent = 'Playing';
  for (const c of caps) {
    c.classList.add('down');
    await sleep(reduce ? 0 : 140);
  }
  await sleep(reduce ? 0 : 220);
  for (const c of caps) c.classList.remove('down');
  must(document, '.demo-wrap').scrollIntoView({
    behavior: reduce ? 'auto' : 'smooth',
    block: 'center',
  });
  pressing = false;
  void demo.play('capture');
}
for (const c of caps) c.addEventListener('click', () => void pressAll());

/* The real keys press the caps too. */
const [alt, shift, x] = caps;
addEventListener('keydown', (e) => {
  if (e.key === 'Alt') alt?.classList.add('down');
  if (e.key === 'Shift') shift?.classList.add('down');
  if (e.code === 'KeyX' && e.altKey && e.shiftKey) x?.classList.add('down');
});
const release = () => {
  for (const c of caps) c.classList.remove('down');
};
addEventListener('keyup', release);
addEventListener('blur', release);
