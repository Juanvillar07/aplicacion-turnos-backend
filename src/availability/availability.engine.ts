import {
  DateString,
  dayOfWeek,
  Interval,
  localTimeToUtc,
  overlaps,
} from './time.utils';

export interface EngineWorkingHours {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface EngineResource {
  id: string;
  workingHours: EngineWorkingHours[];
  /** Citas activas y bloqueos del recurso */
  busy: Interval[];
}

export interface ComputeSlotsInput {
  date: DateString;
  timezone: string;
  durationMinutes: number;
  slotStepMinutes: number;
  /** No se ofrecen turnos que empiecen antes de este instante (ahora + aviso mínimo). */
  earliestStart: Date;
  resources: EngineResource[];
}

export interface Slot {
  startsAt: Date;
  /** Recursos libres en ese turno */
  resourceIds: string[];
}

const MINUTE = 60_000;

/**
 * Calcula los turnos disponibles de un día. Es una función pura (sin base de
 * datos ni reloj) para poder probarla de forma aislada.
 *
 * Para cada recurso recorre sus franjas del día en pasos de `slotStepMinutes`
 * desde el inicio de la franja; un turno es válido si cabe completo dentro de
 * la franja, no se cruza con nada ocupado y no empieza antes de `earliestStart`.
 */
export function computeSlots(input: ComputeSlotsInput): Slot[] {
  const { date, timezone, durationMinutes, slotStepMinutes, earliestStart } =
    input;
  const weekday = dayOfWeek(date);
  const durationMs = durationMinutes * MINUTE;
  const stepMs = Math.max(slotStepMinutes, 1) * MINUTE;
  const byStart = new Map<number, string[]>();

  for (const resource of input.resources) {
    const windows = resource.workingHours.filter(
      (w) => w.dayOfWeek === weekday,
    );

    for (const window of windows) {
      const windowStart = localTimeToUtc(date, window.startMinute, timezone);
      const windowEnd = localTimeToUtc(date, window.endMinute, timezone);

      for (
        let t = windowStart.getTime();
        t + durationMs <= windowEnd.getTime();
        t += stepMs
      ) {
        if (t < earliestStart.getTime()) continue;
        const slot = { start: new Date(t), end: new Date(t + durationMs) };
        if (resource.busy.some((b) => overlaps(slot, b))) continue;

        const ids = byStart.get(t) ?? [];
        if (!ids.includes(resource.id)) ids.push(resource.id);
        byStart.set(t, ids);
      }
    }
  }

  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, resourceIds]) => ({ startsAt: new Date(t), resourceIds }));
}
