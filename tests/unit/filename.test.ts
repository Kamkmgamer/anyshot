import { describe, expect, it } from 'vitest';
import { expandTemplate } from '../../src/shared/filename';

const when = new Date(2026, 10, 19, 7, 5, 9, 42);

describe('filename templates', () => {
  it('expands date and time tokens', () => {
    expect(expandTemplate('anyshot {date} at {time}', when)).toBe('anyshot 2026-11-19 at 07.05.09');
    expect(expandTemplate('{yyyy}{MM}{dd}-{HH}{mm}{ss}-{ms}', when)).toBe('20261119-070509-042');
    expect(expandTemplate('{timestamp}', when)).toBe('20261119-070509');
  });

  it('keeps unknown tokens literally and supports sub-folders', () => {
    expect(expandTemplate('{yyyy}/{nope}', when)).toBe('2026/{nope}');
  });

  it('cannot escape the folder or produce invalid Windows names', () => {
    expect(expandTemplate('../../etc/passwd', when)).toBe('etc/passwd');
    expect(expandTemplate('a:b*c?', when)).toBe('a-b-c-');
    expect(expandTemplate('name. ', when)).toBe('name');
    expect(expandTemplate('///', when)).toBe('anyshot');
  });

  it('uses the random source for {random}', () => {
    expect(expandTemplate('{random}', when, () => 0.5)).toBe('7fffff');
  });
});
