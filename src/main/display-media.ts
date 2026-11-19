import { desktopCapturer, session } from 'electron';
import { onSessionReady } from './windows';

let targetDisplayId: number | null = null;

/** Which display the next getDisplayMedia call (recorder, scroll capture) receives. */
export function setCaptureDisplay(displayId: number): void {
  targetDisplayId = displayId;
}

// Main picks the source, so no picker is shown (except on Wayland, where the portal always asks).
onSessionReady(() => {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const source = sources.find((s) => s.display_id === String(targetDisplayId)) ?? sources[0];
      if (!source) return callback({});
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
