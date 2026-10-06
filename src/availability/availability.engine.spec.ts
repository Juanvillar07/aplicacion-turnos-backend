import { computeSlots, EngineResource } from './availability.engine';
import { localTimeToUtc } from './time.utils';

const TZ = 'America/Bogota'; // UTC-5, sin horario de verano
const MONDAY = '2026-10-05';
const h = (hh: number, mm = 0) => hh * 60 + mm;
/** Instante UTC de una hora local del lunes de prueba */
const at = (hh: number, mm = 0) => localTimeToUtc(MONDAY, h(hh, mm), TZ);
const times = (slots: { startsAt: Date }[]) =>
  slots.map((s) =>
    s.startsAt.toLocaleTimeString('es-CO', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  );

const resource = (
  id: string,
  windows: [number, number][],
  busy: [Date, Date][] = [],
  day = 1,
): EngineResource => ({
  id,
  workingHours: windows.map(([startMinute, endMinute]) => ({
    dayOfWeek: day,
    startMinute,
    endMinute,
  })),
  busy: busy.map(([start, end]) => ({ start, end })),
});

const base = {
  date: MONDAY,
  timezone: TZ,
  durationMinutes: 30,
  slotStepMinutes: 30,
  earliestStart: new Date(0),
};

describe('computeSlots', () => {
  it('convierte la hora local de Bogotá a UTC', () => {
    expect(at(9).toISOString()).toBe('2026-10-05T14:00:00.000Z');
  });

  it('genera turnos dentro de la franja, sin pasarse del cierre', () => {
    const slots = computeSlots({
      ...base,
      durationMinutes: 45,
      resources: [resource('a', [[h(9), h(11)]])],
    });
    // 9:00, 9:30, 10:00 caben; 10:30 + 45 min se pasaría de las 11:00
    expect(times(slots)).toEqual(['09:00', '09:30', '10:00']);
  });

  it('respeta turnos partidos (almuerzo)', () => {
    const slots = computeSlots({
      ...base,
      durationMinutes: 60,
      slotStepMinutes: 60,
      resources: [
        resource('a', [
          [h(9), h(11)],
          [h(14), h(16)],
        ]),
      ],
    });
    expect(times(slots)).toEqual(['09:00', '10:00', '14:00', '15:00']);
  });

  it('descarta turnos que se cruzan con citas o bloqueos', () => {
    const slots = computeSlots({
      ...base,
      resources: [resource('a', [[h(9), h(11)]], [[at(9, 30), at(10, 15)]])],
    });
    // 9:30 y 10:00 se cruzan con la cita de 9:30–10:15
    expect(times(slots)).toEqual(['09:00', '10:30']);
  });

  it('una cita que termina justo cuando empieza el turno no lo bloquea', () => {
    const slots = computeSlots({
      ...base,
      resources: [resource('a', [[h(9), h(10)]], [[at(8), at(9)]])],
    });
    expect(times(slots)).toEqual(['09:00', '09:30']);
  });

  it('respeta el aviso mínimo (earliestStart)', () => {
    const slots = computeSlots({
      ...base,
      earliestStart: at(9, 45),
      resources: [resource('a', [[h(9), h(11)]])],
    });
    expect(times(slots)).toEqual(['10:00', '10:30']);
  });

  it('no ofrece nada si el servicio dura más que la franja', () => {
    const slots = computeSlots({
      ...base,
      durationMinutes: 90,
      resources: [resource('a', [[h(9), h(10)]])],
    });
    expect(slots).toEqual([]);
  });

  it('no ofrece nada en un día sin horario', () => {
    const slots = computeSlots({
      ...base,
      resources: [resource('a', [[h(9), h(18)]], [], 2)], // solo martes
    });
    expect(slots).toEqual([]);
  });

  it('une recursos: cada turno lista quién está libre', () => {
    const slots = computeSlots({
      ...base,
      resources: [
        resource('carlos', [[h(9), h(10)]], [[at(9), at(9, 30)]]),
        resource('andres', [[h(9), h(10)]]),
      ],
    });
    expect(slots.map((s) => [times([s])[0], s.resourceIds])).toEqual([
      ['09:00', ['andres']],
      ['09:30', ['carlos', 'andres']],
    ]);
  });
});
