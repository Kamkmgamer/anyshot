import type { Display } from 'electron';
import type { Rect } from '../shared/geometry';

export async function startScrollCapture(_display: Display, _rect: Rect): Promise<void> {
  console.warn('[anyshot] scroll capture is not implemented yet');
}
