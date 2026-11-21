import { describe, expect, it } from 'vitest';
import {
  RECORDING_QUALITY_OPTIONS,
  recordingQuality,
  recordingSize,
} from '../../src/shared/recording-quality';

describe('recording quality', () => {
  it('labels each quality with its resolution', () => {
    expect(RECORDING_QUALITY_OPTIONS).toEqual([
      ['compact', 'Compact · 720p'],
      ['standard', 'Standard · 1080p'],
      ['high', 'High · 1440p'],
      ['ultra', 'Ultra · 4K (2160p)'],
    ]);
  });

  it('defaults to 4K and keeps saved qualities', () => {
    const field = recordingQuality();
    expect(field.def).toBe('ultra');
    expect(field.parse('standard')).toBe('standard');
    expect(field.parse('medium')).toBe('ultra');
  });

  it('scales an area larger than the resolution down to fit it', () => {
    expect(recordingSize(3840, 2160, 'standard')).toEqual({ width: 1920, height: 1080 });
    expect(recordingSize(3840, 2160, 'compact')).toEqual({ width: 1280, height: 720 });
    expect(recordingSize(5120, 2880, 'ultra')).toEqual({ width: 3840, height: 2160 });
  });

  it('keeps an area that already fits', () => {
    expect(recordingSize(1920, 1080, 'standard')).toEqual({ width: 1920, height: 1080 });
    expect(recordingSize(800, 600, 'compact')).toEqual({ width: 800, height: 600 });
  });

  it('fits portrait and ultrawide areas, keeping their shape', () => {
    // Portrait: the long side is capped at 1920, the short at 1080.
    expect(recordingSize(1440, 2560, 'standard')).toEqual({ width: 1080, height: 1920 });
    // Ultrawide: the long side decides.
    expect(recordingSize(3440, 1440, 'standard')).toEqual({ width: 1920, height: 802 });
  });

  it('gives even sizes', () => {
    const { width, height } = recordingSize(2561, 1441, 'compact');
    expect(width % 2).toBe(0);
    expect(height % 2).toBe(0);
  });
});
