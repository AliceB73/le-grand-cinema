import { DateTime } from 'luxon';

const ZONE = 'Europe/Paris';

export interface RatePeriod {
  startsAt: Date;
  endsAt: Date;
  price: number;
}

// Les dates saisies sont des jours calendaires inclus, en heure de Paris.
export function dayRangeToPeriod(startDate: string, endDate: string) {
  const start = DateTime.fromISO(startDate, { zone: ZONE }).startOf('day');
  const end = DateTime.fromISO(endDate, { zone: ZONE })
    .startOf('day')
    .plus({ days: 1 });
  if (!start.isValid || !end.isValid || end <= start) {
    return null;
  }
  return { startsAt: start.toJSDate(), endsAt: end.toJSDate() };
}

export function periodToDayRange(period: { startsAt: Date; endsAt: Date }) {
  return {
    startDate: DateTime.fromJSDate(period.startsAt, {
      zone: ZONE,
    }).toISODate()!,
    endDate: DateTime.fromJSDate(period.endsAt, { zone: ZONE })
      .minus({ days: 1 })
      .toISODate()!,
  };
}

export function periodsOverlap(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
) {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

export function resolveShowtimePrice(
  startTime: Date,
  defaultPrice: number,
  rates: RatePeriod[],
) {
  const special = rates.find(
    (rate) => rate.startsAt <= startTime && startTime < rate.endsAt,
  );
  return special?.price ?? defaultPrice;
}
