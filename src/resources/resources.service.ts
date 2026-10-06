import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ResourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateResourceDto } from './dto/create-resource.dto';
import { WorkingHoursSlotDto } from './dto/set-working-hours.dto';
import { UpdateResourceDto } from './dto/update-resource.dto';

const resourceInclude = {
  services: { select: { serviceId: true } },
  /** Cuenta del profesional; null = "sin cuenta" */
  user: { select: { id: true, name: true, email: true } },
  workingHours: {
    select: { dayOfWeek: true, startMinute: true, endMinute: true },
    orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
  },
} satisfies Prisma.ResourceInclude;

type ResourceWithRelations = Prisma.ResourceGetPayload<{
  include: typeof resourceInclude;
}>;

/** Aplana la tabla puente para que el cliente reciba `serviceIds: string[]`. */
function toResponse({ services, ...resource }: ResourceWithRelations) {
  return { ...resource, serviceIds: services.map((s) => s.serviceId) };
}

@Injectable()
export class ResourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(businessId: string, includeInactive = false) {
    const resources = await this.prisma.resource.findMany({
      where: { businessId, ...(includeInactive ? {} : { isActive: true }) },
      include: resourceInclude,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return resources.map(toResponse);
  }

  async create(
    businessId: string,
    { serviceIds = [], ...dto }: CreateResourceDto,
  ) {
    if (dto.type === ResourceType.PERSON) {
      throw new BadRequestException(
        'Los profesionales se agregan invitándolos al equipo',
      );
    }
    await this.ensureServicesBelong(businessId, serviceIds);
    const resource = await this.prisma.resource.create({
      data: {
        ...dto,
        businessId,
        services: { create: serviceIds.map((serviceId) => ({ serviceId })) },
      },
      include: resourceInclude,
    });
    return toResponse(resource);
  }

  async update(businessId: string, resourceId: string, dto: UpdateResourceDto) {
    await this.ensureExists(businessId, resourceId);
    const resource = await this.prisma.resource.update({
      where: { id: resourceId },
      data: dto,
      include: resourceInclude,
    });
    return toResponse(resource);
  }

  async deactivate(businessId: string, resourceId: string) {
    await this.ensureExists(businessId, resourceId);
    await this.prisma.resource.update({
      where: { id: resourceId },
      data: { isActive: false },
    });
  }

  async setServices(
    businessId: string,
    resourceId: string,
    serviceIds: string[],
  ) {
    await this.ensureExists(businessId, resourceId);
    await this.ensureServicesBelong(businessId, serviceIds);

    const [, , resource] = await this.prisma.$transaction([
      this.prisma.resourceService.deleteMany({ where: { resourceId } }),
      this.prisma.resourceService.createMany({
        data: serviceIds.map((serviceId) => ({ resourceId, serviceId })),
      }),
      this.prisma.resource.findUniqueOrThrow({
        where: { id: resourceId },
        include: resourceInclude,
      }),
    ]);
    return toResponse(resource);
  }

  /** Reemplaza el horario semanal completo del recurso. */
  async setWorkingHours(
    businessId: string,
    resourceId: string,
    hours: WorkingHoursSlotDto[],
  ) {
    await this.ensureExists(businessId, resourceId);
    validateWorkingHours(hours);

    const [, , resource] = await this.prisma.$transaction([
      this.prisma.workingHours.deleteMany({ where: { resourceId } }),
      this.prisma.workingHours.createMany({
        data: hours.map((h) => ({ ...h, resourceId })),
      }),
      this.prisma.resource.findUniqueOrThrow({
        where: { id: resourceId },
        include: resourceInclude,
      }),
    ]);
    return toResponse(resource);
  }

  private async ensureExists(businessId: string, resourceId: string) {
    const found = await this.prisma.resource.findFirst({
      where: { id: resourceId, businessId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Recurso no encontrado');
  }

  private async ensureServicesBelong(businessId: string, serviceIds: string[]) {
    if (serviceIds.length === 0) return;
    const unique = [...new Set(serviceIds)];
    const count = await this.prisma.service.count({
      where: { businessId, id: { in: unique } },
    });
    if (count !== unique.length) {
      throw new BadRequestException('Alguno de los servicios no existe');
    }
  }
}

const DAY_NAMES = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];

function validateWorkingHours(hours: WorkingHoursSlotDto[]) {
  for (const h of hours) {
    if (h.startMinute >= h.endMinute) {
      throw new BadRequestException(
        `En ${DAY_NAMES[h.dayOfWeek]} la hora de inicio debe ser anterior a la de fin`,
      );
    }
  }

  const sorted = [...hours].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute,
  );
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (
      prev.dayOfWeek === curr.dayOfWeek &&
      curr.startMinute < prev.endMinute
    ) {
      throw new BadRequestException(
        `Hay franjas que se solapan el ${DAY_NAMES[curr.dayOfWeek]}`,
      );
    }
  }
}
