import { describe, expect, it } from 'vitest';
import { sanitizeAttachmentName } from '../../src/server/services/attachments.js';

describe('Attachment name sanitization', () => {
  it('strips path separators and Windows-reserved names', () => {
    expect(sanitizeAttachmentName('C:\\temp\\report.txt')).toBe('report.txt');
    expect(sanitizeAttachmentName('CON.txt')).toBe('_CON.txt');
    expect(sanitizeAttachmentName('..\\..\\evil.png')).toBe('evil.png');
  });

  it('neutralizes cmd metacharacters before the path reaches the shell', () => {
    expect(sanitizeAttachmentName('report 100%.pdf')).toBe('report 100_.pdf');
    expect(sanitizeAttachmentName('100%TEMP%!.png')).toBe('100_TEMP__.png');
  });

  it('caps the stored name at 200 characters', () => {
    expect(sanitizeAttachmentName(`${'a'.repeat(300)}.png`)).toHaveLength(200);
  });
});