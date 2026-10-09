import { DateTime } from 'luxon';
import { PROGRAMME_TIME_ZONE } from './programme-window.js';

const scheduleStart = DateTime.fromISO('2026-10-12', {
  zone: PROGRAMME_TIME_ZONE,
});
const scheduleEnd = DateTime.fromISO('2026-12-31', {
  zone: PROGRAMME_TIME_ZONE,
}).endOf('day');

const weekdayTimes = [
  [18, 0],
  [19, 30],
  [20, 0],
  [20, 30],
] as const;
const weekendTimes = [
  [14, 0],
  [16, 30],
  [17, 0],
  [19, 30],
  [20, 0],
] as const;

export interface DemoShowtime {
  id: string;
  startTime: Date;
}

function createRandom(seed: string) {
  let state = 2166136261;
  for (const character of seed) {
    state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  }

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDemoShowtimes(
  movieKey: string,
  firstWeekIds: readonly [string, string],
): DemoShowtime[] {
  const showtimes: DemoShowtime[] = [];
  let weekStart = scheduleStart;
  let weekIndex = 0;

  while (weekStart <= scheduleEnd) {
    const random = createRandom(`${movieKey}:${weekStart.toISODate()}`);
    const availableDays = Array.from({ length: 7 }, (_, day) =>
      weekStart.plus({ days: day }),
    ).filter((date) => date <= scheduleEnd);

    for (let index = availableDays.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [availableDays[index], availableDays[swapIndex]] = [
        availableDays[swapIndex],
        availableDays[index],
      ];
    }

    const selectedDays = availableDays
      .slice(0, 2)
      .sort((first, second) => first.toMillis() - second.toMillis());

    selectedDays.forEach((date, screeningIndex) => {
      const timeSlots = date.weekday <= 5 ? weekdayTimes : weekendTimes;
      const [hour, minute] = timeSlots[Math.floor(random() * timeSlots.length)];
      const localStartTime = date.set({
        hour,
        minute,
        second: 0,
        millisecond: 0,
      });
      const id =
        weekIndex === 0
          ? firstWeekIds[screeningIndex]
          : `demo-showtime-${movieKey}-${localStartTime.toFormat('yyyyLLdd')}`;

      showtimes.push({
        id,
        startTime: localStartTime.toUTC().toJSDate(),
      });
    });

    weekStart = weekStart.plus({ weeks: 1 });
    weekIndex += 1;
  }

  return showtimes;
}
