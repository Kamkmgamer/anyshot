import { randomUUID } from 'node:crypto';

/** A raw RGBA frame waiting to be fetched by a window over `app://local/@frame/<id>`. */
export interface Frame {
  rgba: Uint8Array;
  width: number;
  height: number;
}

const frames = new Map<string, Frame>();

export function putFrame(frame: Frame): string {
  const id = randomUUID();
  frames.set(id, frame);
  return id;
}

export function getFrame(id: string): Frame | undefined {
  return frames.get(id);
}

/** Windows call this once the pixels are on their canvas, so main drops its copy. */
export function releaseFrame(id: string): void {
  frames.delete(id);
}

export function frameCount(): number {
  return frames.size;
}
