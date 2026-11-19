import { desktopCapturer, session, type WebContents, webContents } from 'electron';
import { onSessionReady } from './windows';

const targets = new WeakMap<WebContents, number>();

export function setCaptureDisplay(contents: WebContents, displayId: number): void {
  targets.set(contents, displayId);
}

// Main picks the source, so no picker is shown (except on Wayland, where the portal always asks).
onSessionReady(() => {
  session.defaultSession.setDisplayMediaRequestHandler(async ({ frame }, callback) => {
    const contents = frame && webContents.fromFrame(frame);
    const displayId = contents && targets.get(contents);
    if (!contents || displayId == null) return callback({});
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const source =
        sources.find((s) => s.display_id === String(displayId)) ??
        (sources.length === 1 && !sources[0]?.display_id ? sources[0] : undefined);
      if (!source || contents.isDestroyed()) return callback({});
      // Windows can add system audio as loopback; Linux has no equivalent here.
      callback({
        video: source,
        ...(process.platform === 'win32' ? { audio: 'loopback' as const } : {}),
      });
    } catch (error) {
      console.error('[display-media] no screen source', error);
      callback({});
    }
  });
});
