import { describe, expect, it } from 'vitest';
import { parseCli } from '../../src/main/cli';

describe('command line', () => {
  it('maps flags to actions and ignores the rest', () => {
    expect(parseCli(['/usr/bin/anyshot', '--capture', '--no-sandbox', '--record'])).toEqual([
      { action: 'captureArea' },
      { action: 'recordArea' },
    ]);
  });

  it('parses --open with a path in both forms', () => {
    expect(parseCli(['--open', '/tmp/a.png'])).toEqual([
      { action: 'openImage', file: '/tmp/a.png' },
    ]);
    expect(parseCli(['--open=/tmp/b.png'])).toEqual([{ action: 'openImage', file: '/tmp/b.png' }]);
    expect(parseCli(['--open', '--capture'])).toEqual([{ action: 'captureArea' }]);
  });
});
