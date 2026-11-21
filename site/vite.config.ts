import { defineConfig } from 'vite';
import { releases } from './plugins/releases';

export default defineConfig({
  // Relative asset paths, so the build works at a custom domain's root and under
  // the github.io project path alike.
  base: './',
  plugins: [releases({ repo: 'mgamergo/anyshot' })],
  build: {
    target: 'es2022',
  },
});
