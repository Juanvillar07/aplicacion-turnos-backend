import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { MANAGER_ROLES } from '../common/tenancy/roles';
import { MailService } from '../mail/mail.service';
import {
  newReviewTemplate,
  reviewRequestTemplate,
} from '../mail/templates/review.templates';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import {
  fillTemplate,
  WHATSAPP_TEMPLATES,
} from '../whatsapp/whatsapp.templates';
import {
  ListReviewsQuery,
  SubmitReviewDto,
  UpdateReviewDto,
} from './dto/review.dto';

/** Días que vale el enlace para reseñar */
const REVIEW_LINK_DAYS = 30;
const PUBLIC_PAGE_SIZE = 5;
const PANEL_PAGE_SIZE = 20;

/** "Laura Gómez" → "Laura G." (en la página pública no va el nombre completo) */
const publicName = (name: string) => {
  const [first, last] = name.trim().split(/\s+/);
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
};

/**
 * Reseñas verificadas: solo quien tuvo una cita completada, una por cita, con
 * un enlace único que llega por correo/WhatsApp. Se publican al instante; el
 * negocio puede responder u ocultarlas (las ocultas no cuentan en el promedio).
 */
@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly whatsapp: WhatsappService,
    config: ConfigService,
  ) {
    this.appUrl = config.get('FRONTEND_URL', 'http://localhost:5173');
  }

  // ─── Pedir la reseña (al completar la cita) ──────────────

  /** Crea el enlace (una sola vez por cita) y lo envía. Nunca lanza errores. */
  async requestReview(appointmentId: string) {
    try {
      const appt = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          customer: true,
          service: { select: { name: true } },
          business: true,
        },
      });
      if (!appt || appt.status !== AppointmentStatus.COMPLETED) return;
      if (appt.reviewToken) return; // ya se pidió (p. ej. NO_SHOW → COMPLETED)

      const token = randomBytes(24).toString('base64url');
      await this.prisma.appointment.update({
        where: { id: appt.id },
        data: { reviewToken: token, reviewRequestedAt: new Date() },
      });

      const url = `${this.appUrl}/resena/${token}`;
      const { customer, business } = appt;
      if (customer.email) {
        await this.mail.send({
          ...reviewRequestTemplate({
            customerName: customer.name,
            businessName: business.name,
            serviceName: appt.service.name,
            url,
          }),
          to: customer.email,
          type: 'review.request',
          businessId: business.id,
        });
      }
      if (business.whatsappEnabled && customer.whatsappOptIn) {
        const template = WHATSAPP_TEMPLATES.review;
        const params = [
          customer.name.split(' ')[0],
          business.name,
          appt.service.name,
          url,
        ];
        const text = fillTemplate(template.body, params);
        const windowOpen = await this.whatsapp.isWindowOpen(customer.phone);
        await this.whatsapp.send(
          customer.phone,
          windowOpen
            ? { kind: 'text', text }
            : { kind: 'template', name: template.name, params, text },
          business.id,
        );
      }
    } catch (error) {
      this.logger.error(
        `No se pudo pedir la reseña de ${appointmentId}: ${(error as Error).message}`,
      );
    }
  }

  // ─── Enlace del cliente ──────────────────────────────────

  async getByToken(token: string) {
    const appt = await this.findByToken(token);
    return {
      business: {
        name: appt.business.name,
        slug: appt.business.slug,
        category: appt.business.category,
        logoUrl: appt.business.logoUrl,
        timezone: appt.business.timezone,
      },
      service: appt.service.name,
      resource: appt.resource.name,
      startsAt: appt.startsAt,
      customerName: appt.customer.name.split(' ')[0],
      expired: this.isExpired(appt.reviewRequestedAt),
      review: appt.review
        ? {
            rating: appt.review.rating,
            comment: appt.review.comment,
            createdAt: appt.review.createdAt,
          }
        : null,
    };
  }

  async submit(token: string, dto: SubmitReviewDto) {
    const appt = await this.findByToken(token);
    if (appt.review) {
      throw new ConflictException('Ya calificaste esta visita. ¡Gracias!');
    }
    if (this.isExpired(appt.reviewRequestedAt)) {
      throw new BadRequestException('Este enlace para calificar ya venció.');
    }
    if (appt.status !== AppointmentStatus.COMPLETED) {
      throw new BadRequestException('Esta cita no se puede calificar.');
    }

    const comment = dto.comment?.trim() || null;
    try {
      await this.prisma.review.create({
        data: {
          businessId: appt.businessId,
          appointmentId: appt.id,
          customerId: appt.customerId,
          rating: dto.rating,
          comment,
        },
      });
    } catch (error) {
      // Dos envíos simultáneos: la restricción única de la cita decide
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya calificaste esta visita. ¡Gracias!');
      }
      throw error;
    }

    void this.notifyAdmins(appt.businessId, {
      customerName: appt.customer.name,
      rating: dto.rating,
      comment,
    });
    return this.getByToken(token);
  }

  // ─── Página pública ──────────────────────────────────────

  /** Promedio y conteo (sin las ocultas) */
  async summary(businessId: string) {
    const [aggregate, byStars] = await Promise.all([
      this.prisma.review.aggregate({
        where: { businessId, hidden: false },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.prisma.review.groupBy({
        by: ['rating'],
        where: { businessId, hidden: false },
        _count: { _all: true },
      }),
    ]);
    const count = aggregate._count._all;
    return {
      count,
      average: count
        ? Math.round((aggregate._avg.rating ?? 0) * 10) / 10
        : null,
      byStars: [5, 4, 3, 2, 1].map((stars) => ({
        stars,
        count: byStars.find((b) => b.rating === stars)?._count._all ?? 0,
      })),
    };
  }

  async publicList(businessId: string, page = 1) {
    const where = { businessId, hidden: false };
    const [total, reviews] = await Promise.all([
      this.prisma.review.count({ where }),
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PUBLIC_PAGE_SIZE,
        take: PUBLIC_PAGE_SIZE,
        include: {
          customer: { select: { name: true } },
          appointment: { select: { service: { select: { name: true } } } },
        },
      }),
    ]);
    return {
      items: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        reply: r.reply,
        repliedAt: r.repliedAt,
        createdAt: r.createdAt,
        author: publicName(r.customer.name),
        serviceName: r.appointment.service.name,
      })),
      total,
      page,
      pageSize: PUBLIC_PAGE_SIZE,
    };
  }

  // ─── Panel del negocio ───────────────────────────────────

  async panelList(businessId: string, { rating, page = 1 }: ListReviewsQuery) {
    const where: Prisma.ReviewWhereInput = {
      businessId,
      ...(rating && { rating }),
    };
    const [total, reviews, summary, hiddenCount] = await Promise.all([
      this.prisma.review.count({ where }),
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PANEL_PAGE_SIZE,
        take: PANEL_PAGE_SIZE,
        include: {
          customer: { select: { id: true, name: true } },
          appointment: {
            select: {
              startsAt: true,
              service: { select: { name: true } },
              resource: { select: { name: true } },
            },
          },
        },
      }),
      this.summary(businessId),
      this.prisma.review.count({ where: { businessId, hidden: true } }),
    ]);
    return {
      items: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        reply: r.reply,
        repliedAt: r.repliedAt,
        hidden: r.hidden,
        createdAt: r.createdAt,
        customer: r.customer,
        serviceName: r.appointment.service.name,
        resourceName: r.appointment.resource.name,
        appointmentStartsAt: r.appointment.startsAt,
      })),
      total,
      page,
      pageSize: PANEL_PAGE_SIZE,
      summary: { ...summary, hidden: hiddenCount },
    };
  }

  async update(businessId: string, reviewId: string, dto: UpdateReviewDto) {
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, businessId },
    });
    if (!review) throw new NotFoundException('Reseña no encontrada');

    const data: Prisma.ReviewUpdateInput = {};
    if (dto.hidden !== undefined) data.hidden = dto.hidden;
    if (dto.reply !== undefined) {
      const reply = dto.reply?.trim() || null;
      data.reply = reply;
      data.repliedAt = reply ? new Date() : null;
    }
    await this.prisma.review.update({ where: { id: review.id }, data });
    return this.panelList(businessId, {});
  }

  // ─── Auxiliares ──────────────────────────────────────────

  private async findByToken(token: string) {
    const appt = await this.prisma.appointment.findUnique({
      where: { reviewToken: token },
      include: {
        business: true,
        service: { select: { name: true } },
        resource: { select: { name: true } },
        customer: { select: { name: true } },
        review: true,
      },
    });
    if (!appt) throw new NotFoundException('Enlace no válido');
    return appt;
  }

  private isExpired(requestedAt: Date | null) {
    return (
      !requestedAt ||
      requestedAt.getTime() + REVIEW_LINK_DAYS * 24 * 60 * 60_000 < Date.now()
    );
  }

  private async notifyAdmins(
    businessId: string,
    d: { customerName: string; rating: number; comment: string | null },
  ) {
    try {
      const business = await this.prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: {
          name: true,
          memberships: {
            where: { role: { in: MANAGER_ROLES } },
            select: { user: { select: { email: true } } },
          },
        },
      });
      const email = newReviewTemplate({
        businessName: business.name,
        ...d,
        url: `${this.appUrl}/app/reviews`,
      });
      await Promise.all(
        business.memberships.map(({ user }) =>
          this.mail.send({
            ...email,
            to: user.email,
            type: 'review.new',
            businessId,
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `No se pudo avisar la reseña nueva: ${(error as Error).message}`,
      );
    }
  }
}
