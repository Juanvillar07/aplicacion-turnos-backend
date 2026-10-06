import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BusinessStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PublicBookingService {
  constructor(private readonly prisma: PrismaService) {}

  async findBusinessBySlug(slug: string) {
    const business = await this.prisma.business.findUnique({ where: { slug } });
    if (!business) throw new NotFoundException('Negocio no encontrado');
    if (business.status === BusinessStatus.SUSPENDED) {
      throw new ForbiddenException(
        'Este negocio no está recibiendo reservas en línea por ahora',
      );
    }
    return business;
  }

  /** Solo información pública: nada de miembros, ajustes internos ni clientes. */
  async getPublicProfile(slug: string) {
    const business = await this.findBusinessBySlug(slug);
    const [services, resources] = await Promise.all([
      this.prisma.service.findMany({
        where: { businessId: business.id, isActive: true },
        select: {
          id: true,
          name: true,
          description: true,
          durationMinutes: true,
          price: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.resource.findMany({
        where: {
          businessId: business.id,
          isActive: true,
          workingHours: { some: {} },
        },
        select: {
          id: true,
          name: true,
          type: true,
          services: { select: { serviceId: true } },
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      name: business.name,
      slug: business.slug,
      category: business.category,
      phone: business.phone,
      address: business.address,
      city: business.city,
      timezone: business.timezone,
      maxDaysAhead: business.maxDaysAhead,
      autoConfirm: business.autoConfirm,
      whatsappEnabled: business.whatsappEnabled,
      services,
      resources: resources.map(({ services: links, ...r }) => ({
        ...r,
        serviceIds: links.map((l) => l.serviceId),
      })),
    };
  }
}
