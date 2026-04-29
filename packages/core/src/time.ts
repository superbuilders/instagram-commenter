export const APP_TIME_ZONE = "America/Chicago";

function getZonedParts(date: Date, timeZone = APP_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return values as {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function getLocalDateString(date = new Date(), timeZone = APP_TIME_ZONE): string {
  const parts = getZonedParts(date, timeZone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function addDaysToLocalDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function getTimeZoneOffsetMs(date: Date, timeZone = APP_TIME_ZONE): number {
  const parts = getZonedParts(date, timeZone);
  const zonedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return zonedAsUtc - date.getTime();
}

export function zonedTimeToUtc(
  dateStr: string,
  time: { hour?: number; minute?: number; second?: number; millisecond?: number } = {},
  timeZone = APP_TIME_ZONE
): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const localAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    time.hour ?? 0,
    time.minute ?? 0,
    time.second ?? 0,
    time.millisecond ?? 0
  );

  const firstPass = new Date(localAsUtc - getTimeZoneOffsetMs(new Date(localAsUtc), timeZone));
  return new Date(localAsUtc - getTimeZoneOffsetMs(firstPass, timeZone));
}

export function getLocalDateRangeUtc(dateStr: string, timeZone = APP_TIME_ZONE) {
  const nextDateStr = addDaysToLocalDateString(dateStr, 1);
  return {
    start: zonedTimeToUtc(dateStr, {}, timeZone),
    end: new Date(zonedTimeToUtc(nextDateStr, {}, timeZone).getTime() - 1),
  };
}
