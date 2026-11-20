import { describe, expect, it } from 'vitest';
import { type PressTarget, pressOutcome } from '../../src/windows/common/popover';

/** A stand-in element that is inside the elements matching `inside`. */
const at = (...inside: string[]): PressTarget => ({
  closest: (selector) => (selector.split(',').some((s) => inside.includes(s.trim())) ? {} : null),
});

describe('popover dismissal', () => {
  it('keeps the popover open for presses inside it or on a popover toggle', () => {
    expect(pressOutcome(at('.popover'))).toBe('keep');
    expect(pressOutcome(at('.popover', 'button'))).toBe('keep');
    expect(pressOutcome(at('[aria-haspopup="dialog"]', 'button'))).toBe('keep');
  });

  it('closes it for presses on other controls, which still act', () => {
    expect(pressOutcome(at('button'))).toBe('close');
    expect(pressOutcome(at('[role="toolbar"]'))).toBe('close');
    expect(pressOutcome(at('input'))).toBe('close');
  });

  it('only closes it for presses on the canvas or page', () => {
    expect(pressOutcome(at())).toBe('close-only');
    expect(pressOutcome(null)).toBe('close-only');
  });
});
