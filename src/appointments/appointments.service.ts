import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentSource,
  AppointmentStatus,
  Business,
  BusinessStatus,
  Prisma,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import {
  ACTIVE_STATUSES,
  AvailabilityService,
} from '../availability/availability.service';
import {
  addDays,
  DateString,
  localDayRange,
  toLocalDate,
} from '../availability/time.utils';
import { CustomerData, CustomersService } from '../customers/customers.service';
import {
  NotificationsService,
  NotifyOptions,
} from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewsService } from '../reviews/reviews.service';

export const panelAppointmentInclude = {
  customer: { select: { id: true, name: true, email: true, phone: true } },
  service: { select: { id: true, name: true, durationMinutes: true } },
  resource: { select: { id: true, name: true, type: true } },
} satisfies Prisma.AppointmentInclude;

/** Cambios de estado permitidos desde el panel */
const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'NO_SHOW', 'CANCELLED'],
  COMPLETED: ['NO_SHOW'],
  NO_SHOW: ['COMPLETED'],
  CANCELLED: [],
};

export interface BookInput {
  business: Business;
  serviceId: string;
  resourceId?: string | null;
  startsAt: Date;
  customer: CustomerData;
  source: AppointmentSource;
  notes?: string;
}

const SUSPENDED = 'Este negocio no está recibiendo reservas por ahora';
const SLOT_TAKEN = 'Ese horario acaba de ser reservado. Elige otro, por favor.';
const SLOT_UNAVAILABLE =
  'Ese horario ya no está disponible. Elige otro, por favor.';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly customers: CustomersService,
    private readonly notifications: NotificationsService,
    private readonly reviews: ReviewsService,
  ) {}

  /**
   * Reserva un turno. Lo usan la página pública y el panel.
   * 1. Revalida con el motor de disponibilidad que el turno siga libre.
   * 2. Si se pidió "cualquiera", asigna el recurso libre con menos citas ese día.
   * 3. Crea cliente + cita en una transacción. La restricción
   *    `appointments_no_overlap` de Postgres resuelve las carreras.
   */
  async book(input: BookInput) {
    const { business, source } = input;
    const isPanel = source === AppointmentSource.PANEL;
    const date = toLocalDate(input.startsAt, business.timezone);

    if (business.status === BusinessStatus.SUSPENDED) {
      throw new BadRequestException(SUSPENDED);
    }
    if (!isPanel) this.assertWithinHorizon(business, date);

    const { service, slots } = await this.availability.getSlots({
      business,
      serviceId: input.serviceId,
      resourceId: input.resourceId,
      date,
      ignoreMinNotice: isPanel,
    });
    const slot = slots.find(
      (s) => s.startsAt.getTime() === input.startsAt.getTime(),
    );
    if (!slot) throw new ConflictException(SLOT_TAKEN);

    const resourceId =
      input.resourceId ??
      (await this.leastBusy(slot.resourceIds, business, date));
    const endsAt = new Date(
      input.startsAt.getTime() + service.durationMinutes * 60_000,
    );
    const status =
      isPanel || business.autoConfirm
        ? AppointmentStatus.CONFIRMED
        : AppointmentStatus.PENDING;

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const customer = await this.customers.upsertByPhone(
          business.id,
          input.customer,
          tx,
        );
        return tx.appointment.create({
          data: {
            businessId: business.id,
            resourceId,
            serviceId: service.id,
            customerId: customer.id,
            startsAt: input.startsAt,
            endsAt,
            status,
            price: service.price,
            source,
            notes: input.notes,
            manageToken: randomBytes(24).toString('base64url'),
          },
          include: panelAppointmentInclude,
        });
      });
      this.notifications.notifyAppointment(created.id, { kind: 'created' });
      return created;
    } catch (error) {
      if (isOverlapViolation(error)) throw new ConflictException(SLOT_TAKEN);
      throw error;
    }
  }

  /** `scope`: recursos permitidos (profesional) o null (todo el negocio). */
  findByDay(
    business: Business,
    date: DateString,
    scope: string[] | null = null,
  ) {
    const range = localDayRange(date, business.timezone);
    return this.prisma.appointment.findMany({
      where: {
        businessId: business.id,
        ...(scope && { resourceId: { in: scope } }),
        startsAt: { lt: range.end },
        endsAt: { gt: range.start },
      },
      include: panelAppointmentInclude,
      orderBy: { startsAt: 'asc' },
    });
  }

  /** Reservas futuras que esperan confirmación del negocio. */
  countPending(businessId: string, scope: string[] | null = null) {
    return this.prisma.appointment.count({
      where: {
        businessId,
        ...(scope && { resourceId: { in: scope } }),
        status: AppointmentStatus.PENDING,
        startsAt: { gte: new Date() },
      },
    });
  }

  async updateStatus(
    businessId: string,
    appointmentId: string,
    next: AppointmentStatus,
    scope: string[] | null = null,
  ) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, businessId },
    });
    if (!appointment) throw new NotFoundException('Cita no encontrada');
    if (scope && !scope.includes(appointment.resourceId)) {
      throw new ForbiddenException(
        'Solo puedes gestionar las citas de tu propia agenda',
      );
    }

    if (!TRANSITIONS[appointment.status].includes(next)) {
      throw new BadRequestException(
        `No se puede pasar una cita de ${appointment.status} a ${next}`,
      );
    }
    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: next,
        cancelledAt: next === AppointmentStatus.CANCELLED ? new Date() : null,
      },
      include: panelAppointmentInclude,
    });

    if (
      appointment.status === AppointmentStatus.PENDING &&
      next === AppointmentStatus.CONFIRMED
    ) {
      this.notifications.notifyAppointment(appointmentId, { kind: 'approved' });
    } else if (next === AppointmentStatus.CANCELLED) {
      this.notifications.notifyAppointment(appointmentId, {
        kind: 'cancelled',
        by: 'business',
      });
    } else if (next === AppointmentStatus.COMPLETED) {
      // "¿Cómo te fue?": enlace para reseñar (una sola vez por cita)
      void this.reviews.requestReview(appointmentId);
    }
    return updated;
  }

  // ─── Enlace privado del cliente ──────────────────────────

  async findByToken(token: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { manageToken: token },
      include: {
        business: {
          select: {
            name: true,
            slug: true,
            category: true,
            phone: true,
            address: true,
            city: true,
            timezone: true,
            minNoticeMinutes: true,
            status: true,
          },
        },
        service: { select: { name: true, durationMinutes: true } },
        resource: { select: { name: true, type: true } },
        customer: { select: { name: true } },
      },
    });
    if (!appointment) throw new NotFoundException('Cita no encontrada');

    const {
      manageToken: _token,
      business: { minNoticeMinutes, status, ...business },
      ...rest
    } = appointment;
    void _token;
    const isActive = ACTIVE_STATUSES.includes(appointment.status);
    const now = Date.now();
    return {
      ...rest,
      business,
      canCancel: isActive && appointment.startsAt.getTime() > now,
      // Reprogramar respeta la anticipación mínima del negocio
      canReschedule:
        isActive &&
        status === BusinessStatus.ACTIVE &&
        appointment.startsAt.getTime() > now + minNoticeMinutes * 60_000,
    };
  }

  async cancelByToken(token: string, options: NotifyOptions = {}) {
    const appointment = await this.findByToken(token);
    if (!appointment.canCancel) {
      throw new BadRequestException('Esta cita ya no se puede cancelar');
    }
    await this.prisma.appointment.update({
      where: { manageToken: token },
      data: { status: AppointmentStatus.CANCELLED, cancelledAt: new Date() },
    });
    this.notifications.notifyAppointment(
      appointment.id,
      { kind: 'cancelled', by: 'customer' },
      options,
    );
    return this.findByToken(token);
  }

  // ─── Reprogramar desde el enlace del cliente ─────────────
  // Se mantiene el mismo servicio, profesional y precio; solo cambia la hora.

  async rescheduleDays(token: string) {
    const { appointment, business } = await this.loadReschedulable(token);
    return this.availability.daysWithAvailability({
      business,
      serviceId: appointment.serviceId,
      resourceId: appointment.resourceId,
      excludeAppointmentId: appointment.id,
    });
  }

  async rescheduleSlots(token: string, date: DateString) {
    const { appointment, business } = await this.loadReschedulable(token);
    const { slots } = await this.availability.getSlots({
      business,
      serviceId: appointment.serviceId,
      resourceId: appointment.resourceId,
      excludeAppointmentId: appointment.id,
      date,
    });
    return slots;
  }

  async reschedule(token: string, startsAt: Date) {
    const { appointment, business } = await this.loadReschedulable(token);
    if (startsAt.getTime() === appointment.startsAt.getTime()) {
      throw new BadRequestException('Tu cita ya está en ese horario');
    }

    const date = toLocalDate(startsAt, business.timezone);
    this.assertWithinHorizon(business, date);
    const { service, slots } = await this.availability.getSlots({
      business,
      serviceId: appointment.serviceId,
      resourceId: appointment.resourceId,
      excludeAppointmentId: appointment.id,
      date,
    });
    if (!slots.some((s) => s.startsAt.getTime() === startsAt.getTime())) {
      throw new ConflictException(SLOT_UNAVAILABLE);
    }

    try {
      await this.prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          startsAt,
          endsAt: new Date(
            startsAt.getTime() + service.durationMinutes * 60_000,
          ),
          // Con confirmación manual, el negocio debe aprobar el nuevo horario
          status: business.autoConfirm
            ? appointment.status
            : AppointmentStatus.PENDING,
        },
      });
    } catch (error) {
      if (isOverlapViolation(error)) throw new ConflictException(SLOT_TAKEN);
      throw error;
    }

    this.notifications.notifyAppointment(appointment.id, {
      kind: 'rescheduled',
      previousStartsAt: appointment.startsAt,
    });
    return this.findByToken(token);
  }

  private async loadReschedulable(token: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { manageToken: token },
      include: { business: true },
    });
    if (!appointment) throw new NotFoundException('Cita no encontrada');

    const { business } = appointment;
    if (business.status === BusinessStatus.SUSPENDED) {
      throw new BadRequestException(SUSPENDED);
    }
    const limit = Date.now() + business.minNoticeMinutes * 60_000;
    if (
      !ACTIVE_STATUSES.includes(appointment.status) ||
      appointment.startsAt.getTime() <= limit
    ) {
      throw new BadRequestException(
        'Esta cita ya no se puede reprogramar. Comunícate con el negocio.',
      );
    }
    return { appointment, business };
  }

  // ─── Auxiliares ──────────────────────────────────────────

  private assertWithinHorizon(business: Business, date: DateString) {
    const today = toLocalDate(new Date(), business.timezone);
    if (date < today || date > addDays(today, business.maxDaysAhead)) {
      throw new BadRequestException(
        'Esa fecha no está disponible para reservar',
      );
    }
  }

  /** Reparte la carga: el recurso con menos citas activas ese día. */
  private async leastBusy(
    resourceIds: string[],
    business: Business,
    date: DateString,
  ): Promise<string> {
    const range = localDayRange(date, business.timezone);
    const counts = await this.prisma.appointment.groupBy({
      by: ['resourceId'],
      where: {
        resourceId: { in: resourceIds },
        status: { in: ACTIVE_STATUSES },
        startsAt: { gte: range.start, lt: range.end },
      },
      _count: true,
    });
    const countOf = (id: string) =>
      counts.find((c) => c.resourceId === id)?._count ?? 0;
    return [...resourceIds].sort((a, b) => countOf(a) - countOf(b))[0];
  }
}

/** Violación de la restricción EXCLUDE (código Postgres 23P01). */
function isOverlapViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('appointments_no_overlap') || message.includes('23P01')
  );
}
