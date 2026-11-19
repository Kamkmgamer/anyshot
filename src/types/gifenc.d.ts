declare module 'gifenc' {
  export type Palette = number[][];
  export interface Encoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: { palette?: Palette; delay?: number; repeat?: number; first?: boolean },
    ): void;
    finish(): void;
    reset(): void;
    bytesView(): Uint8Array;
  }
  export function GIFEncoder(options?: { auto?: boolean }): Encoder;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: object,
  ): Palette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: string,
  ): Uint8Array;
}
