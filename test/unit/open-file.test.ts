import { describe, expect, it } from 'vitest';
import { windowsStartArguments } from '../../src/server/services/open-file.js';

describe('Windows attachment opening', () => {
  it('passes an empty window title and one quoted path', () => {
    expect(windowsStartArguments('C:\\Users\\João\\My Files\\report.pdf')).toEqual([
      '/c',
      'start',
      '""',
      '"C:\\Users\\João\\My Files\\report.pdf"',
    ]);
  });

  it('cannot inject another argument through the path', () => {
    const args = windowsStartArguments('C:\\data\\a" & calc.exe & ".txt');
    expect(args).toHaveLength(4);
    expect(args[3]).toBe('"C:\\data\\a & calc.exe & .txt"');
  });
});