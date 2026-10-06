import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TZDate } from '@date-fns/tz';
import {
  AdminActionType,
  BusinessStatus,
  EmailStatus,
  MemberRole,
  Prisma,
  WhatsappDirection,
  PaymentStatus,
  SubscriptionStatus,
  WhatsappStatus,
} from '@prisma/client';
import { format, subMonths } from 'date-fns';
import { MailService } from '../mail/mail.service';
import {
  businessReactivatedTemplate,
  businessSuspendedTemplate,
} from '../mail/templates/account.templates';
import { PrismaService } from '../prisma/prisma.service';
import { ListBusinessesQuery } from './dto/admin.dto';

/** Zona horaria de la plataforma para cortar los meses de las métricas */
const PLATFORM_TZ = 'America/Bogota';
/** Meses que muestran las gráficas de evolución */
const HISTORY_MONTHS = 6;
const PAGE_SIZE = 20;

/** Inicio (instante UTC) del mes actual, o de `monthsAgo` meses atrás, en Bogotá */
function monthStart(monthsAgo = 0): Date {
  const now = new TZDate(Date.now(), PLATFORM_TZ);
  const first = new TZDate(now.getFullYear(), now.getMonth(), 1, PLATFORM_TZ);
  return new Date(subMonths(first, monthsAgo).getTime());
}

/** Claves "2026-05" … "2026-10" de los últimos meses, del más antiguo al actual */
function monthKeys(): string[] {
  return Array.from({ length: HISTORY_MONTHS }, (_, i) =>
    format(
      new TZDate(monthStart(HISTORY_MONTHS - 1 - i).getTime(), PLATFORM_TZ),
      'yyyy-MM',
    ),
  );
}

type CountRow = { month: string; count: bigint };

/** Resumen de la suscripción de un negocio para el superadministrador */
const subscriptionSummarySelect = {
  status: true,
  isComplimentary: true,
  currentPeriodEnd: true,
  plan: { select: { code: true, name: true, priceMonthly: true } },
} satisfies Prisma.SubscriptionSelect;

/** Convierte un groupBy de Prisma en { CLAVE: cantidad } */
function tally<K extends string>(
  rows: { _count: { _all: number } }[],
  key: (row: never) => K,
): Partial<Record<K, number>> {
  const result: Partial<Record<K, number>> = {};
  for (const row of rows) result[key(row as never)] = row._count._all;
  return result;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // ─── Métricas globales ───────────────────────────────────

  async metrics() {
    const thisMonth = monthStart(0);
    const lastMonth = monthStart(1);
    const since = monthStart(HISTORY_MONTHS - 1);

    const [
      businessesByStatus,
      newBusinesses,
      users,
      newUsers,
      apptsThisMonth,
      apptsLastMonth,
      apptsBySource,
      emails,
      whatsappOut,
      whatsappIn,
      byCategory,
      top,
      apptsHistory,
      businessesHistory,
    ] = await Promise.all([
      this.prisma.business.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.business.count({ where: { createdAt: { gte: thisMonth } } }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: thisMonth } } }),
      this.prisma.appointment.count({
        where: { createdAt: { gte: thisMonth } },
      }),
      this.prisma.appointment.count({
        where: { createdAt: { gte: lastMonth, lt: thisMonth } },
      }),
      this.prisma.appointment.groupBy({
        by: ['source'],
        where: { createdAt: { gte: thisMonth } },
        _count: { _all: true },
      }),
      this.prisma.emailLog.groupBy({
        by: ['status'],
        where: { createdAt: { gte: thisMonth } },
        _count: { _all: true },
      }),
      this.prisma.whatsappMessage.groupBy({
        by: ['status'],
        where: {
          direction: WhatsappDirection.OUT,
          createdAt: { gte: thisMonth },
        },
        _count: { _all: true },
      }),
      this.prisma.whatsappMessage.count({
        where: {
          direction: WhatsappDirection.IN,
          createdAt: { gte: thisMonth },
        },
      }),
      this.prisma.business.groupBy({
        by: ['category'],
        _count: { _all: true },
      }),
      this.prisma.appointment.groupBy({
        by: ['businessId'],
        where: { createdAt: { gte: thisMonth } },
        _count: { _all: true },
        orderBy: { _count: { businessId: 'desc' } },
        take: 5,
      }),
      this.countByMonth('appointments', since),
      this.countByMonth('businesses', since),
    ]);

    const statuses = tally(
      businessesByStatus,
      (r: { status: BusinessStatus }) => r.status,
    );
    const [topNames, subscriptions] = await Promise.all([
      this.prisma.business.findMany({
        where: { id: { in: top.map((t) => t.businessId) } },
        select: { id: true, name: true, slug: true },
      }),
      this.subscriptionMetrics(thisMonth, lastMonth),
    ]);

    return {
      businesses: {
        total: (statuses.ACTIVE ?? 0) + (statuses.SUSPENDED ?? 0),
        active: statuses.ACTIVE ?? 0,
        suspended: statuses.SUSPENDED ?? 0,
        newThisMonth: newBusinesses,
      },
      users: { total: users, newThisMonth: newUsers },
      subscriptions,
      appointments: {
        thisMonth: apptsThisMonth,
        lastMonth: apptsLastMonth,
        bySource: {
          WEB: 0,
          PANEL: 0,
          WHATSAPP: 0,
          ...tally(apptsBySource, (r: { source: string }) => r.source),
        },
      },
      messages: {
        email: this.emailSummary(emails),
        whatsapp: { ...this.whatsappSummary(whatsappOut), inbound: whatsappIn },
      },
      byCategory: byCategory
        .map((c) => ({ category: c.category, count: c._count._all }))
        .sort((a, b) => b.count - a.count),
      topBusinesses: top.map((t) => ({
        ...topNames.find((b) => b.id === t.businessId)!,
        appointments: t._count._all,
      })),
      history: monthKeys().map((month) => ({
        month,
        appointments: apptsHistory.get(month) ?? 0,
        businesses: businessesHistory.get(month) ?? 0,
      })),
    };
  }

  // ─── Negocios ────────────────────────────────────────────

  async listBusinesses({ search, status, page = 1 }: ListBusinessesQuery) {
    const term = search?.trim();
    const where: Prisma.BusinessWhereInput = {
      ...(status && { status }),
      ...(term && {
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { slug: { contains: term, mode: 'insensitive' } },
          { city: { contains: term, mode: 'insensitive' } },
          {
            memberships: {
              some: {
                role: MemberRole.ADMIN,
                user: { email: { contains: term, mode: 'insensitive' } },
              },
            },
          },
        ],
      }),
    };

    const [total, businesses] = await Promise.all([
      this.prisma.business.count({ where }),
      this.prisma.business.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          name: true,
          slug: true,
          category: true,
          city: true,
          status: true,
          whatsappEnabled: true,
          createdAt: true,
          memberships: {
            where: { role: MemberRole.ADMIN },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { user: { select: { name: true, email: true } } },
          },
          _count: { select: { memberships: true } },
          subscription: { select: subscriptionSummarySelect },
        },
      }),
    ]);

    const usage = await this.prisma.appointment.groupBy({
      by: ['businessId'],
      where: {
        businessId: { in: businesses.map((b) => b.id) },
        createdAt: { gte: monthStart(0) },
      },
      _count: { _all: true },
    });

    return {
      items: businesses.map(({ memberships, _count, ...b }) => ({
        ...b,
        owner: memberships[0]?.user ?? null,
        membersCount: _count.memberships,
        appointmentsThisMonth:
          usage.find((u) => u.businessId === b.id)?._count._all ?? 0,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  /** Ficha completa de un negocio para dar soporte. */
  async getBusiness(id: string) {
    const business = await this.prisma.business.findUnique({
      where: { id },
      include: {
        memberships: {
          orderBy: { createdAt: 'asc' },
          select: {
            role: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                emailVerifiedAt: true,
              },
            },
          },
        },
        _count: {
          select: {
            services: true,
            resources: true,
            customers: true,
            appointments: true,
          },
        },
        subscription: {
          select: {
            ...subscriptionSummarySelect,
            currentPeriodStart: true,
            payments: {
              orderBy: { createdAt: 'desc' },
              take: 12,
              select: {
                id: true,
                amount: true,
                status: true,
                provider: true,
                cardBrand: true,
                cardLast4: true,
                failureReason: true,
                createdAt: true,
              },
            },
          },
        },
        adminActions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            type: true,
            reason: true,
            createdAt: true,
            admin: { select: { name: true, email: true } },
          },
        },
      },
    });
    if (!business) throw new NotFoundException('Negocio no encontrado');

    const thisMonth = monthStart(0);
    const [
      bySource,
      byStatus,
      emails,
      whatsapp,
      history,
      lastAppointment,
      failedEmails,
      failedWhatsapp,
    ] = await Promise.all([
      this.prisma.appointment.groupBy({
        by: ['source'],
        where: { businessId: id, createdAt: { gte: thisMonth } },
        _count: { _all: true },
      }),
      this.prisma.appointment.groupBy({
        by: ['status'],
        where: { businessId: id, createdAt: { gte: thisMonth } },
        _count: { _all: true },
      }),
      this.prisma.emailLog.groupBy({
        by: ['status'],
        where: { businessId: id, createdAt: { gte: thisMonth } },
        _count: { _all: true },
      }),
      this.prisma.whatsappMessage.groupBy({
        by: ['status'],
        where: {
          businessId: id,
          direction: WhatsappDirection.OUT,
          createdAt: { gte: thisMonth },
        },
        _count: { _all: true },
      }),
      this.countByMonth('appointments', monthStart(HISTORY_MONTHS - 1), id),
      this.prisma.appointment.findFirst({
        where: { businessId: id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      // Sin destinatarios: el superadministrador no necesita datos de clientes
      this.prisma.emailLog.findMany({
        where: { businessId: id, status: EmailStatus.FAILED },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, type: true, error: true, createdAt: true },
      }),
      this.prisma.whatsappMessage.findMany({
        where: {
          businessId: id,
          direction: WhatsappDirection.OUT,
          status: WhatsappStatus.FAILED,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, kind: true, error: true, createdAt: true },
      }),
    ]);

    const { memberships, _count, adminActions, ...rest } = business;
    const totalThisMonth = bySource.reduce((n, r) => n + r._count._all, 0);
    return {
      ...rest,
      members: memberships.map(({ user, role, createdAt }) => ({
        ...user,
        role,
        joinedAt: createdAt,
      })),
      counts: _count,
      lastAppointmentAt: lastAppointment?.createdAt ?? null,
      usage: {
        thisMonth: totalThisMonth,
        bySource: {
          WEB: 0,
          PANEL: 0,
          WHATSAPP: 0,
          ...tally(bySource, (r: { source: string }) => r.source),
        },
        byStatus: tally(byStatus, (r: { status: string }) => r.status),
        email: this.emailSummary(emails),
        whatsapp: this.whatsappSummary(whatsapp),
        history: monthKeys().map((month) => ({
          month,
          appointments: history.get(month) ?? 0,
        })),
      },
      recentFailures: [
        ...failedEmails.map((e) => ({
          id: e.id,
          channel: 'email' as const,
          kind: e.type,
          error: e.error,
          createdAt: e.createdAt,
        })),
        ...failedWhatsapp.map((w) => ({
          id: w.id,
          channel: 'whatsapp' as const,
          kind: w.kind,
          error: w.error,
          createdAt: w.createdAt,
        })),
      ]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 8),
      actions: adminActions,
    };
  }

  // ─── Suspender / reactivar ───────────────────────────────

  async suspend(id: string, adminId: string, reason: string) {
    const business = await this.findOrThrow(id);
    if (business.status === BusinessStatus.SUSPENDED) {
      throw new BadRequestException('Este negocio ya está suspendido');
    }
    await this.prisma.$transaction([
      this.prisma.business.update({
        where: { id },
        data: {
          status: BusinessStatus.SUSPENDED,
          suspendedAt: new Date(),
          suspendedReason: reason,
        },
      }),
      this.prisma.adminAction.create({
        data: {
          adminId,
          businessId: id,
          type: AdminActionType.SUSPEND_BUSINESS,
          reason,
        },
      }),
    ]);
    void this.notifyOwners(id, 'business.suspended', (name) =>
      businessSuspendedTemplate({ businessName: name, reason }),
    );
    return this.getBusiness(id);
  }

  async reactivate(id: string, adminId: string) {
    const business = await this.findOrThrow(id);
    if (business.status === BusinessStatus.ACTIVE) {
      throw new BadRequestException('Este negocio ya está activo');
    }
    await this.prisma.$transaction([
      this.prisma.business.update({
        where: { id },
        data: {
          status: BusinessStatus.ACTIVE,
          suspendedAt: null,
          suspendedReason: null,
        },
      }),
      this.prisma.adminAction.create({
        data: {
          adminId,
          businessId: id,
          type: AdminActionType.REACTIVATE_BUSINESS,
        },
      }),
    ]);
    const url = `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/app`;
    void this.notifyOwners(id, 'business.reactivated', (name) =>
      businessReactivatedTemplate({ businessName: name, url }),
    );
    return this.getBusiness(id);
  }

  // ─── Auxiliares ──────────────────────────────────────────

  /** Ingresos por suscripciones (pagos aprobados) y negocios activos por plan */
  private async subscriptionMetrics(thisMonth: Date, lastMonth: Date) {
    const approved = (from: Date, to?: Date) =>
      this.prisma.subscriptionPayment.aggregate({
        where: {
          status: PaymentStatus.APPROVED,
          createdAt: { gte: from, ...(to && { lt: to }) },
        },
        _sum: { amount: true },
        _count: { _all: true },
      });
    const [current, previous, byPlan, plans, complimentary] = await Promise.all(
      [
        approved(thisMonth),
        approved(lastMonth, thisMonth),
        this.prisma.subscription.groupBy({
          by: ['planId'],
          where: {
            status: SubscriptionStatus.ACTIVE,
            businessId: { not: null },
          },
          _count: { _all: true },
        }),
        this.prisma.plan.findMany({
          orderBy: { sortOrder: 'asc' },
          select: { id: true, code: true, name: true },
        }),
        this.prisma.subscription.count({
          where: {
            status: SubscriptionStatus.ACTIVE,
            businessId: { not: null },
            isComplimentary: true,
          },
        }),
      ],
    );
    return {
      revenueThisMonth: current._sum.amount ?? 0,
      revenueLastMonth: previous._sum.amount ?? 0,
      paymentsThisMonth: current._count._all,
      complimentary,
      byPlan: plans.map((plan) => ({
        code: plan.code,
        name: plan.name,
        count: byPlan.find((b) => b.planId === plan.id)?._count._all ?? 0,
      })),
    };
  }

  private async findOrThrow(id: string) {
    const business = await this.prisma.business.findUnique({ where: { id } });
    if (!business) throw new NotFoundException('Negocio no encontrado');
    return business;
  }

  /** Avisa por correo a los administradores. Nunca hace fallar la acción. */
  private async notifyOwners(
    businessId: string,
    type: string,
    render: (businessName: string) => {
      subject: string;
      html: string;
      text: string;
    },
  ) {
    try {
      const business = await this.prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: {
          name: true,
          memberships: {
            where: { role: MemberRole.ADMIN },
            select: { user: { select: { email: true } } },
          },
        },
      });
      const email = render(business.name);
      await Promise.all(
        business.memberships.map(({ user }) =>
          this.mail.send({ ...email, to: user.email, type, businessId }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `No se pudo avisar a los administradores: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Registros por mes (hora de Bogotá) desde `since`. Las columnas created_at
   * guardan la hora UTC sin zona, por eso la doble conversión.
   */
  private async countByMonth(
    table: 'appointments' | 'businesses',
    since: Date,
    businessId?: string,
  ): Promise<Map<string, number>> {
    const month = Prisma.sql`to_char(date_trunc('month', created_at AT TIME ZONE 'UTC' AT TIME ZONE ${PLATFORM_TZ}), 'YYYY-MM')`;
    const filter = businessId
      ? Prisma.sql`AND business_id = ${businessId}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<CountRow[]>`
      SELECT ${month} AS month, count(*) AS count
      FROM ${Prisma.raw(`"${table}"`)}
      WHERE created_at >= ${since} ${filter}
      GROUP BY 1`;
    return new Map(rows.map((r) => [r.month, Number(r.count)]));
  }

  private emailSummary(
    rows: { status: EmailStatus; _count: { _all: number } }[],
  ) {
    const t = tally(rows, (r: { status: EmailStatus }) => r.status);
    return {
      sent: t.SENT ?? 0,
      failed: t.FAILED ?? 0,
      preview: t.PREVIEW ?? 0,
    };
  }

  private whatsappSummary(
    rows: { status: WhatsappStatus; _count: { _all: number } }[],
  ) {
    const t = tally(rows, (r: { status: WhatsappStatus }) => r.status);
    return {
      sent: t.SENT ?? 0,
      failed: t.FAILED ?? 0,
      preview: t.PREVIEW ?? 0,
    };
  }
}
