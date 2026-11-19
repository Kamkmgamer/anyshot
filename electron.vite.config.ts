import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig } from 'electron-vite';

// One HTML entry per window type; each window loads only its own bundle.
const WINDOWS = [
  'overlay',
  'editor',
  'floating',
  'pin',
  'history',
  'settings',
  'recorder',
  'scroll',
  'ocr',
] as const;

const rendererInputs = Object.fromEntries(
  WINDOWS.map((name) => [name, resolve(`src/windows/${name}/index.html`)]).filter(([, path]) =>
    existsSync(path as string),
  ),
);

const utilityInputs = Object.fromEntries(
  ['ocr']
    .map((name) => [`utility-${name}`, resolve(`src/utility/${name}.ts`)])
    .filter(([, path]) => existsSync(path as string)),
);

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), ...utilityInputs },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        // Sandboxed preloads must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve('src/windows'),
    base: './',
    plugins: [preact()],
    worker: { format: 'es' },
    build: {
      target: 'chrome140',
      outDir: resolve('out/renderer'),
      modulePreload: { polyfill: false },
      rollupOptions: { input: rendererInputs },
    },
  },
});
