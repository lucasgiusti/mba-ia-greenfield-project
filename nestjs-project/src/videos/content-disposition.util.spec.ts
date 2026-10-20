import { buildAttachmentDisposition } from './content-disposition.util';

describe('buildAttachmentDisposition', () => {
  it('should keep a common file name unchanged', () => {
    expect(buildAttachmentDisposition('clip.mp4')).toBe(
      'attachment; filename="clip.mp4"',
    );
  });

  it('should keep spaces, dashes and accented characters', () => {
    expect(buildAttachmentDisposition('Férias 2026 - final.mov')).toBe(
      'attachment; filename="Férias 2026 - final.mov"',
    );
  });

  it('should remove double quotes and backslashes', () => {
    expect(buildAttachmentDisposition('my "best" \\clip\\.mp4')).toBe(
      'attachment; filename="my best clip.mp4"',
    );
  });

  it('should remove control characters (CR, LF, NUL, TAB, DEL)', () => {
    expect(
      buildAttachmentDisposition('a\r\nSet-Cookie: x\u0000\t\u007fb.mp4'),
    ).toBe('attachment; filename="aSet-Cookie: xb.mp4"');
  });
});
