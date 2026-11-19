import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '../../src/main/app-state';
import { endCapture, isCapturing, startCapture } from '../../src/main/capture/session';
import { frameCount, type Frame } from '../../src/main/frames';

const { createWindow, grabDisplay } = vi.hoisted(() => ({
  createWindow: vi.fn(),
  grabDisplay: vi.fn<() => Promise<Frame>>(),
}));

vi.mock('electron', () => {
  const display = { id: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } };
  return {
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => display,
      getAllDisplays: () => [display],
    },
  };
});
vi.mock('../../src/main/capture/grab', () => ({ grabDisplay }));
vi.mock('../../src/main/windows', () => ({ createWindow }));
vi.mock('../../src/main/ipc', () => ({ handle: () => {} }));
vi.mock('../../src/main/settings-store', () => ({
  getSettings: () => ({ capture: { instantCapture: false } }),
}));
vi.mock('../../src/main/test-hooks', () => ({ recordTiming: () => {} }));

class Overlay extends EventEmitter {
  webContents = { id: 1 };
  isDestroyed = () => this.closed;
  setAlwaysOnTop = () => {};
  setVisibleOnAllWorkspaces = () => {};
  setBounds = () => {};
  closed = false;

  destroy(): void {
    this.closed = true;
    this.emit('closed');
  }
}

const frame: Frame = { width: 1, height: 1, rgba: new Uint8Array(4) };

beforeEach(() => {
  vi.useFakeTimers();
  createWindow.mockReset().mockImplementation(() => new Overlay());
  grabDisplay.mockReset().mockResolvedValue(frame);
});

afterEach(() => {
  endCapture();
  appState.delaySeconds = 0;
  vi.useRealTimers();
});

describe('capture sessions', () => {
  it('starts one session for overlapping delayed requests', async () => {
    appState.delaySeconds = 1;
    const requests = Promise.all([startCapture('area'), startCapture('area')]);
    await vi.advanceTimersByTimeAsync(1000);
    await requests;
    expect(createWindow).toHaveBeenCalledTimes(1);
    endCapture();
    expect(isCapturing()).toBe(false);
    expect(frameCount()).toBe(0);
  });

  it('discards a display grab that resolves after cancellation', async () => {
    let resolveGrab: (frame: Frame) => void = () => {};
    const grab = new Promise<Frame>((resolve) => {
      resolveGrab = resolve;
    });
    grabDisplay.mockReturnValue(grab);
    const started = startCapture('area');
    expect(isCapturing()).toBe(true);
    endCapture();
    resolveGrab(frame);
    await started;
    expect(isCapturing()).toBe(false);
    expect(frameCount()).toBe(0);
  });
});
