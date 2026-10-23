import { describe, expect, it } from '@jest/globals';
import { getAllowedCorsOrigins } from './cors-origins.js';

describe('getAllowedCorsOrigins', () => {
  it('defaults to the local development origins', () => {
    expect(getAllowedCorsOrigins(undefined)).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
  });

  it('parses and deduplicates configured HTTP(S) origins', () => {
    expect(
      getAllowedCorsOrigins(
        'https://aliceb73.github.io, http://localhost:5173,https://aliceb73.github.io',
      ),
    ).toEqual(['https://aliceb73.github.io', 'http://localhost:5173']);
  });

  it('rejects URLs with a path or a non-HTTP protocol', () => {
    expect(() =>
      getAllowedCorsOrigins('https://aliceb73.github.io/le-grand-cinema'),
    ).toThrow();
    expect(() => getAllowedCorsOrigins('file://example.com')).toThrow();
  });

  it('rejects empty entries rather than silently allowing a partial list', () => {
    expect(() =>
      getAllowedCorsOrigins('https://aliceb73.github.io,'),
    ).toThrow();
  });
});
