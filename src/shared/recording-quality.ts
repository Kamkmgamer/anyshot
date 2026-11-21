import { oneOf } from './schema';

export const RECORDING_QUALITIES = ['compact', 'standard', 'high'] as const;
export type RecordingQuality = (typeof RECORDING_QUALITIES)[number];

export const RECORDING_QUALITY_OPTIONS = [
  ['compact', 'Compact'],
  ['standard', 'Standard'],
  ['high', 'High'],
] as const satisfies readonly (readonly [RecordingQuality, string])[];

export const recordingQuality = (fallback: RecordingQuality = 'high') =>
  oneOf(RECORDING_QUALITIES, fallback);
