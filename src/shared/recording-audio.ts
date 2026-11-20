import type { RecordAudio } from './ipc';
import { isRecord } from './schema';

/**
 * The audio a recording takes: the record bar's choice (or the saved defaults
 * if the request has none or a malformed one). GIFs have no audio, and
 * computer audio needs a platform that provides it.
 */
export function recordingAudio(
  defaults: RecordAudio,
  chosen: unknown,
  gif: boolean,
  systemAudioAvailable: boolean,
): RecordAudio {
  const pick = (key: keyof RecordAudio): boolean => {
    const value = isRecord(chosen) ? chosen[key] : undefined;
    return typeof value === 'boolean' ? value : defaults[key];
  };
  return {
    microphone: !gif && pick('microphone'),
    systemAudio: !gif && systemAudioAvailable && pick('systemAudio'),
  };
}
