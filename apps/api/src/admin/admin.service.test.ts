import { describe, expect, it } from '@jest/globals';
import { findOverlap, slotEnd } from './admin.service.js';

const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 11, 1, hour, minute));

describe('findOverlap', () => {
  const existing = [
    { startTime: at(18), durationMinutes: 120, movieTitle: 'Film A' },
  ];

  it('detects a candidate starting during an existing showtime', () => {
    expect(
      findOverlap({ startTime: at(19), durationMinutes: 90 }, existing)
        ?.movieTitle,
    ).toBe('Film A');
  });

  it('detects a candidate ending during an existing showtime', () => {
    expect(
      findOverlap({ startTime: at(16), durationMinutes: 150 }, existing),
    ).toBeDefined();
  });

  it('allows back-to-back showtimes', () => {
    expect(
      findOverlap({ startTime: at(20), durationMinutes: 90 }, existing),
    ).toBeUndefined();
    expect(
      findOverlap({ startTime: at(16), durationMinutes: 120 }, existing),
    ).toBeUndefined();
  });

  it('computes the end time', () => {
    expect(slotEnd(at(18), 105)).toEqual(at(19, 45));
  });
});
