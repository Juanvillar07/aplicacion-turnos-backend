import { Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, Business } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeSlots, EngineResource, Slot } from './availability.engine';
import {
  addDays,
  DateString,
  Interval,
  localDayRange,
  overlaps,
  toLocalDate,
} from './time.utils';

/** Citas vigentes: se pueden cancelar y las protege la restricción anti-solape */
export const ACTIVE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
];

/** Estados que ocupan el horario al calcular disponibilidad */
const BUSY_STATUSES: AppointmentStatus[] = [
  ...ACTIVE_STATUSES,
  AppointmentStatus.COMPLETED,
];

export type BookingSettings = Pick<
  Business,
  'id' | 'timezone' | 'slotStepMinutes' | 'minNoticeMinutes' | 'maxDaysAhead'
>;

export interface AvailabilityQuery {
  business: BookingSettings;
  serviceId: string;
  resourceId?: string | null;
  /** Las citas creadas desde el panel no exigen el aviso mínimo */
  ignoreMinNotice?: boolean;
  /** Al reprogramar, la propia cita no cuenta como ocupada */
  excludeAppointmentId?: string;
}

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Turnos disponibles de un día concreto. */
  async getSlots(query: AvailabilityQuery & { date: DateString }) {
    const { service, resources } = await this.loadContext(query);
    const range = localDayRange(query.date, query.business.timezone);
    const busy = await this.loadBusy(
      resources.map((r) => r.id),
      range,
      query.excludeAppointmentId,
    );
    return {
      service,
      slots: this.compute(
        query,
        query.date,
        service.durationMinutes,
        resources,
        busy,
      ),
    };
  }

  /**
   * Días (desde hoy hasta el horizonte de reserva) que tienen al menos un
   * turno libre. Carga lo ocupado del rango completo una sola vez.
   */
  async daysWithAvailability(query: AvailabilityQuery, now = new Date()) {
    const { business } = query;
    const { service, resources } = await this.loadContext(query);
    const today = toLocalDate(now, business.timezone);
    const lastDay = addDays(today, business.maxDaysAhead);
    const busy = await this.loadBusy(
      resources.map((r) => r.id),
      {
        start: localDayRange(today, business.timezone).start,
        end: localDayRange(lastDay, business.timezone).end,
      },
      query.excludeAppointmentId,
    );

    const days: DateString[] = [];
    for (let d = today; d <= lastDay; d = addDays(d, 1)) {
      const slots = this.compute(
        query,
        d,
        service.durationMinutes,
        resources,
        busy,
        now,
      );
      if (slots.length > 0) days.push(d);
    }
    return days;
  }

  private compute(
    query: AvailabilityQuery,
    date: DateString,
    durationMinutes: number,
    resources: { id: string; workingHours: EngineResource['workingHours'] }[],
    busy: Map<string, Interval[]>,
    now = new Date(),
  ): Slot[] {
    const { business, ignoreMinNotice } = query;
    const earliestStart = ignoreMinNotice
      ? new Date(0)
      : new Date(now.getTime() + business.minNoticeMinutes * 60_000);

    return computeSlots({
      date,
      timezone: business.timezone,
      durationMinutes,
      slotStepMinutes: business.slotStepMinutes,
      earliestStart,
      resources: resources.map((r) => ({
        id: r.id,
        workingHours: r.workingHours,
        busy: busy.get(r.id) ?? [],
      })),
    });
  }

  /** Servicio activo + recursos activos que lo prestan (opcionalmente uno). */
  private async loadContext({
    business,
    serviceId,
    resourceId,
  }: AvailabilityQuery) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, businessId: business.id, isActive: true },
    });
    if (!service) throw new NotFoundException('Servicio no encontrado');

    const resources = await this.prisma.resource.findMany({
      where: {
        businessId: business.id,
        isActive: true,
        services: { some: { serviceId } },
        ...(resourceId ? { id: resourceId } : {}),
      },
      select: {
        id: true,
        workingHours: {
          select: { dayOfWeek: true, startMinute: true, endMinute: true },
        },
      },
    });
    if (resourceId && resources.length === 0) {
      throw new NotFoundException('Ese profesional no ofrece este servicio');
    }
    return { service, resources };
  }

  /** Citas activas y bloqueos que se cruzan con el rango, agrupados por recurso. */
  private async loadBusy(
    resourceIds: string[],
    range: Interval,
    excludeAppointmentId?: string,
  ) {
    const where = {
      resourceId: { in: resourceIds },
      startsAt: { lt: range.end },
      endsAt: { gt: range.start },
    };
    const [appointments, timeOffs] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          ...where,
          status: { in: BUSY_STATUSES },
          ...(excludeAppointmentId && { id: { not: excludeAppointmentId } }),
        },
        select: { resourceId: true, startsAt: true, endsAt: true },
      }),
      this.prisma.timeOff.findMany({
        where,
        select: { resourceId: true, startsAt: true, endsAt: true },
      }),
    ]);

    const busy = new Map<string, Interval[]>();
    for (const b of [...appointments, ...timeOffs]) {
      const interval = { start: b.startsAt, end: b.endsAt };
      if (!overlaps(interval, range)) continue;
      busy.set(b.resourceId, [...(busy.get(b.resourceId) ?? []), interval]);
    }
    return busy;
  }
}
