import type { Display } from 'electron';
import type { Rect } from '../shared/geometry';

export async function startRecording(_display: Display, _rect: Rect, _gif: boolean): Promise<void> {
  console.warn('[anyshot] recording is not implemented yet');
}

export async function stopRecording(): Promise<void> {}
