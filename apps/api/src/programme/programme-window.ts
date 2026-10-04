import { DateTime } from 'luxon';

export const PROGRAMME_TIME_ZONE = 'Europe/Paris';

export function getProgrammeWindow(now: Date) {
  const localToday = DateTime.fromJSDate(now, {
    zone: PROGRAMME_TIME_ZONE,
  }).startOf('day');
  const endExclusive = localToday
    .plus({ days: 7 })
    .startOf('day')
    .toUTC()
    .toJSDate();

  return {
    from: now,
    until: endExclusive,
  };
}
