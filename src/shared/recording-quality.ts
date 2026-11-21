import { oneOf } from './schema';

export const RECORDING_QUALITIES = ['compact', 'standard', 'high', 'ultra'] as const;
export type RecordingQuality = (typeof RECORDING_QUALITIES)[number];

/** Each quality caps the video's resolution and picks how hard the encoder compresses it. */
export const RECORDING_QUALITY_PRESETS: Record<
  RecordingQuality,
  {
    label: string;
    /** The long and short side of the largest video, e.g. 1920 × 1080 for 1080p. */
    maxSize: readonly [number, number];
    bitrate: 'low' | 'medium' | 'high';
  }
> = {
  compact: { label: 'Compact · 720p', maxSize: [1280, 720], bitrate: 'low' },
  standard: { label: 'Standard · 1080p', maxSize: [1920, 1080], bitrate: 'medium' },
  high: { label: 'High · 1440p', maxSize: [2560, 1440], bitrate: 'high' },
  ultra: { label: 'Ultra · 4K (2160p)', maxSize: [3840, 2160], bitrate: 'high' },
};

export const RECORDING_QUALITY_OPTIONS = RECORDING_QUALITIES.map(
  (q) => [q, RECORDING_QUALITY_PRESETS[q].label] as const,
);

export const recordingQuality = (fallback: RecordingQuality = 'ultra') =>
  oneOf(RECORDING_QUALITIES, fallback);

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * The size to encode a recorded area of `width` × `height` at: the area itself when it
 * fits the quality's resolution (in either orientation), else scaled down to fit, keeping
 * its aspect ratio. Never scales up. Both sides are even, as H.264 needs.
 */
export function recordingSize(
  width: number,
  height: number,
  quality: RecordingQuality,
): { width: number; height: number } {
  const [long, short] = RECORDING_QUALITY_PRESETS[quality].maxSize;
  const scale = Math.min(
    1,
    long / Math.max(width, height),
    short / Math.max(1, Math.min(width, height)),
  );
  return { width: even(width * scale), height: even(height * scale) };
}
