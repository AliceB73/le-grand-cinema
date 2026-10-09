import { describe, expect, it } from '@jest/globals';
import { DateTime } from 'luxon';
import { PROGRAMME_TIME_ZONE } from './programme-window.js';
import { generateDemoShowtimes } from './demo-schedule.js';

describe('generateDemoShowtimes', () => {
  const firstWeekIds = ['legacy-screening-1', 'legacy-screening-2'] as const;

  it('creates two distinct, stable screenings per movie each week through year-end', () => {
    const showtimes = generateDemoShowtimes('veilleurs-du-phare', firstWeekIds);
    const groupedByWeek = new Map<string, Date[]>();

    for (const showtime of showtimes) {
      const weekStart = DateTime.fromJSDate(showtime.startTime, {
        zone: PROGRAMME_TIME_ZONE,
      })
        .startOf('week')
        .toFormat('yyyy-LL-dd');
      const weekShowtimes = groupedByWeek.get(weekStart) ?? [];
      weekShowtimes.push(showtime.startTime);
      groupedByWeek.set(weekStart, weekShowtimes);
    }

    expect(showtimes).toHaveLength(24);
    expect(new Set(showtimes.map(({ id }) => id)).size).toBe(24);
    expect(showtimes.slice(0, 2).map(({ id }) => id)).toEqual(firstWeekIds);
    expect(
      showtimes.every(({ startTime }) => {
        const localDate = DateTime.fromJSDate(startTime, {
          zone: PROGRAMME_TIME_ZONE,
        });
        const localDateKey = localDate.toFormat('yyyy-LL-dd');
        return localDateKey >= '2026-10-12' && localDateKey <= '2026-12-31';
      }),
    ).toBe(true);
    expect(groupedByWeek.size).toBe(12);
    expect([...groupedByWeek.values()].every((week) => week.length === 2)).toBe(
      true,
    );
    expect(
      groupedByWeek
        .get('2026-12-28')
        ?.every(
          (date) =>
            DateTime.fromJSDate(date, { zone: PROGRAMME_TIME_ZONE }).day <= 31,
        ),
    ).toBe(true);
    expect(generateDemoShowtimes('veilleurs-du-phare', firstWeekIds)).toEqual(
      showtimes,
    );
  });

  it('uses realistic Paris screening times and varies schedules by film', () => {
    const firstMovie = generateDemoShowtimes(
      'veilleurs-du-phare',
      firstWeekIds,
    );
    const secondMovie = generateDemoShowtimes('jardin-des-etoiles', [
      'legacy-screening-3',
      'legacy-screening-4',
    ]);

    const screeningTimes = firstMovie.map((showtime) =>
      DateTime.fromJSDate(showtime.startTime, {
        zone: PROGRAMME_TIME_ZONE,
      }).toFormat('HH:mm'),
    );

    expect(
      screeningTimes.every((time) =>
        [
          '14:00',
          '16:30',
          '17:00',
          '18:00',
          '19:30',
          '20:00',
          '20:30',
        ].includes(time),
      ),
    ).toBe(true);
    expect(
      firstMovie.map(({ startTime }) => startTime.toISOString()),
    ).not.toEqual(secondMovie.map(({ startTime }) => startTime.toISOString()));
  });
});
