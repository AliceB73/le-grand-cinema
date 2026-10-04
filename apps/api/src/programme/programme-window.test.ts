import { describe, expect, it } from '@jest/globals';
import { DateTime } from 'luxon';
import { getProgrammeWindow, PROGRAMME_TIME_ZONE } from './programme-window.js';

describe('getProgrammeWindow', () => {
  it('ends at midnight after today and the next six Paris calendar days', () => {
    const now = new Date('2026-10-04T14:00:00.000Z');
    const window = getProgrammeWindow(now);

    expect(window.from).toBe(now);
    expect(window.until.toISOString()).toBe('2026-10-10T22:00:00.000Z');
    expect(
      DateTime.fromJSDate(window.until, { zone: PROGRAMME_TIME_ZONE }).toISO(),
    ).toBe('2026-10-11T00:00:00.000+02:00');
  });

  it('uses Paris calendar days across the spring daylight-saving transition', () => {
    const now = new Date('2026-03-28T11:00:00.000Z');
    const window = getProgrammeWindow(now);

    expect(window.until.toISOString()).toBe('2026-04-03T22:00:00.000Z');
    expect(window.until.getTime() - now.getTime()).toBe(
      6 * 24 * 60 * 60 * 1000 + 11 * 60 * 60 * 1000,
    );
  });

  it('uses Paris calendar days across the autumn daylight-saving transition', () => {
    const now = new Date('2026-10-24T10:00:00.000Z');
    const window = getProgrammeWindow(now);

    expect(window.until.toISOString()).toBe('2026-10-30T23:00:00.000Z');
    expect(window.until.getTime() - now.getTime()).toBe(
      6 * 24 * 60 * 60 * 1000 + 13 * 60 * 60 * 1000,
    );
  });
});
