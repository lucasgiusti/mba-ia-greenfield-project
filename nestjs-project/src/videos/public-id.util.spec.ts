import { generatePublicId } from './public-id.util';

describe('generatePublicId', () => {
  it('should return an 11-character string', () => {
    expect(generatePublicId()).toHaveLength(11);
  });

  it('should only use the base64url alphabet', () => {
    for (let i = 0; i < 1000; i++) {
      expect(generatePublicId()).toMatch(/^[A-Za-z0-9_-]{11}$/);
    }
  });

  it('should not repeat across 10,000 calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10000; i++) {
      ids.add(generatePublicId());
    }
    expect(ids.size).toBe(10000);
  });
});
