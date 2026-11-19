/** Small piece of shared main-process state that the tray reflects. */
type Listener = () => void;

export const appState = {
  recording: false as boolean,
  delaySeconds: 0,
};
const listeners = new Set<Listener>();

export function setAppState(patch: Partial<typeof appState>): void {
  Object.assign(appState, patch);
  for (const listener of listeners) listener();
}

export function onAppState(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
