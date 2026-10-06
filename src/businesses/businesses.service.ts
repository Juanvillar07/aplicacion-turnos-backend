import { ConflictException, Injectable } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { slugify } from '../common/utils/slugify';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';

@Injectable()
export class BusinessesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Crea el negocio y deja al usuario como ADMIN, de forma atómica. Exige una
   * suscripción pagada (sin negocio) del usuario, que queda vinculada.
   */
  async create(userId: string, dto: CreateBusinessDto) {
    await this.subscriptions.assertCanCreateBusiness(userId);
    const slug = await this.generateUniqueSlug(dto.name);

    const business = await this.prisma.$transaction(async (tx) => {
      const created = await tx.business.create({
        data: {
          ...dto,
          slug,
          memberships: { create: { userId, role: MemberRole.ADMIN } },
        },
      });
      await this.subscriptions.attachToBusiness(tx, userId, created.id);
      return created;
    });
    return { ...business, role: MemberRole.ADMIN };
  }

  /** Negocios a los que pertenece el usuario, con su rol en cada uno. */
  async findMine(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { business: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map(({ business, role }) => ({ ...business, role }));
  }

  findById(businessId: string) {
    return this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
    });
  }

  async update(businessId: string, dto: UpdateBusinessDto) {
    if (dto.slug && !(await this.isSlugAvailable(dto.slug, businessId))) {
      throw new ConflictException('Ese enlace ya está en uso');
    }
    return this.prisma.business.update({
      where: { id: businessId },
      data: dto,
    });
  }

  async isSlugAvailable(slug: string, exceptBusinessId?: string) {
    const existing = await this.prisma.business.findUnique({
      where: { slug },
      select: { id: true },
    });
    return !existing || existing.id === exceptBusinessId;
  }

  /** "barberia-don-juan", "barberia-don-juan-2", … */
  private async generateUniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'negocio';
    const taken = await this.prisma.business.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });
    const takenSet = new Set(taken.map((b) => b.slug));

    let slug = base;
    for (let i = 2; takenSet.has(slug); i++) {
      slug = `${base}-${i}`;
    }
    return slug;
  }
}
