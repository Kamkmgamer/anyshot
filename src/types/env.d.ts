import type { AnyshotApi } from '../shared/ipc';

declare global {
  interface Window {
    anyshot: AnyshotApi;
  }
}
