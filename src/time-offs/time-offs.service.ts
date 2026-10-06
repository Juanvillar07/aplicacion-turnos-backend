import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Business } from '@prisma/client';
import { panelAppointmentInclude } from '../appointments/appointments.service';
import { ACTIVE_STATUSES } from '../availability/availability.service';
import { DateString, localDayRange } from '../availability/time.utils';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTimeOffDto } from './dto/create-time-off.dto';

const MAX_DAYS = 90;

@Injectable()
export class TimeOffsService {
  constructor(private readonly prisma: PrismaService) {}

  findByDay(
    business: Business,
    date: DateString,
    scope: string[] | null = null,
  ) {
    const range = localDayRange(date, business.timezone);
    return this.prisma.timeOff.findMany({
      where: {
        businessId: business.id,
        ...(scope && { resourceId: { in: scope } }),
        startsAt: { lt: range.end },
        endsAt: { gt: range.start },
      },
      include: { resource: { select: { id: true, name: true } } },
      orderBy: { startsAt: 'asc' },
    });
  }

  /**
   * Crea el bloqueo. No cancela citas existentes: las devuelve en `conflicts`
   * para que el negocio decida qué hacer con ellas.
   */
  async create(businessId: string, dto: CreateTimeOffDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (startsAt >= endsAt) {
      throw new BadRequestException('El inicio debe ser anterior al fin');
    }
    if (endsAt.getTime() - startsAt.getTime() > MAX_DAYS * 86_400_000) {
      throw new BadRequestException(
        `Un bloqueo no puede durar más de ${MAX_DAYS} días`,
      );
    }

    const resource = await this.prisma.resource.findFirst({
      where: { id: dto.resourceId, businessId },
      select: { id: true },
    });
    if (!resource) throw new NotFoundException('Recurso no encontrado');

    const timeOff = await this.prisma.timeOff.create({
      data: {
        businessId,
        resourceId: dto.resourceId,
        startsAt,
        endsAt,
        reason: dto.reason,
      },
      include: { resource: { select: { id: true, name: true } } },
    });

    const conflicts = await this.prisma.appointment.findMany({
      where: {
        resourceId: dto.resourceId,
        status: { in: ACTIVE_STATUSES },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      include: panelAppointmentInclude,
      orderBy: { startsAt: 'asc' },
    });

    return { timeOff, conflicts };
  }

  async remove(businessId: string, timeOffId: string) {
    const { count } = await this.prisma.timeOff.deleteMany({
      where: { id: timeOffId, businessId },
    });
    if (count === 0) throw new NotFoundException('Bloqueo no encontrado');
  }
}
