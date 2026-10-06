import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(businessId: string, includeInactive = false) {
    return this.prisma.service.findMany({
      where: { businessId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  create(businessId: string, dto: CreateServiceDto) {
    return this.prisma.service.create({ data: { ...dto, businessId } });
  }

  async update(businessId: string, serviceId: string, dto: UpdateServiceDto) {
    await this.ensureExists(businessId, serviceId);
    return this.prisma.service.update({
      where: { id: serviceId },
      data: dto,
    });
  }

  /** Baja lógica: el servicio deja de ofrecerse pero conserva su historial. */
  async deactivate(businessId: string, serviceId: string) {
    await this.ensureExists(businessId, serviceId);
    await this.prisma.service.update({
      where: { id: serviceId },
      data: { isActive: false },
    });
  }

  /** Siempre filtra por businessId para impedir accesos entre inquilinos. */
  private async ensureExists(businessId: string, serviceId: string) {
    const found = await this.prisma.service.findFirst({
      where: { id: serviceId, businessId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Servicio no encontrado');
  }
}
