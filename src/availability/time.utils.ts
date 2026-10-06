import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';

/** Fecha local del negocio en formato `YYYY-MM-DD`. */
export type DateString = string;

export const DATE_STRING_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface Interval {
  start: Date;
  end: Date;
}

function parts(date: DateString): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

/** Instante UTC que corresponde a `date` + `minutes` desde las 00:00 en `timezone`. */
export function localTimeToUtc(
  date: DateString,
  minutes: number,
  timezone: string,
): Date {
  const [y, m, d] = parts(date);
  const local = new TZDate(
    y,
    m - 1,
    d,
    Math.floor(minutes / 60),
    minutes % 60,
    0,
    timezone,
  );
  return new Date(local.getTime());
}

/** 0 = domingo … 6 = sábado (no depende de la zona horaria). */
export function dayOfWeek(date: DateString): number {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Inicio y fin (exclusivo) del día local en UTC. */
export function localDayRange(date: DateString, timezone: string): Interval {
  return {
    start: localTimeToUtc(date, 0, timezone),
    end: localTimeToUtc(addDays(date, 1), 0, timezone),
  };
}

export function addDays(date: DateString, days: number): DateString {
  const [y, m, d] = parts(date);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** Fecha local (YYYY-MM-DD) de un instante en la zona del negocio. */
export function toLocalDate(instant: Date, timezone: string): DateString {
  return format(new TZDate(instant.getTime(), timezone), 'yyyy-MM-dd');
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function isValidDateString(value: string): boolean {
  if (!DATE_STRING_PATTERN.test(value)) return false;
  const [y, m, d] = parts(value);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
