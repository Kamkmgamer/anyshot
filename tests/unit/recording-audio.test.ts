import { describe, expect, it } from 'vitest';
import { recordingAudio } from '../../src/shared/recording-audio';

const defaults = { microphone: true, systemAudio: true };

describe('recording audio', () => {
  it('follows the record bar, falling back to the saved defaults', () => {
    expect(recordingAudio(defaults, { microphone: false, systemAudio: true }, false, true)).toEqual(
      {
        microphone: false,
        systemAudio: true,
      },
    );
    expect(recordingAudio(defaults, undefined, false, true)).toEqual(defaults);
    // A malformed choice can't turn anything on by accident; it falls back field by field.
    expect(
      recordingAudio({ microphone: false, systemAudio: false }, { microphone: 'yes' }, false, true),
    ).toEqual({
      microphone: false,
      systemAudio: false,
    });
  });

  it('records no audio for GIFs and no computer audio where it is unavailable', () => {
    expect(recordingAudio(defaults, defaults, true, true)).toEqual({
      microphone: false,
      systemAudio: false,
    });
    expect(recordingAudio(defaults, defaults, false, false)).toEqual({
      microphone: true,
      systemAudio: false,
    });
  });
});
