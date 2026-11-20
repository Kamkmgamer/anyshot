import { describe, expect, it } from 'vitest';
import { pickedColorMessage } from '../../src/windows/common/annotator';

describe('colour picker toast', () => {
  it('says what happened to the picked colour, in upper-case hex', () => {
    expect(pickedColorMessage('#e11d48', 'set')).toBe('Colour set to #E11D48');
    expect(pickedColorMessage('#e11d48', 'copied')).toBe('Copied #E11D48 to the clipboard');
    expect(pickedColorMessage('#00ff00', 'copy-failed')).toBe('Could not copy #00FF00');
  });
});
