import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentStatus,
  PlanCode,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { addMonths } from 'date-fns';
import { PrismaService } from '../prisma/prisma.service';
import { PaySubscriptionDto } from './dto/subscription.dto';
import { PaymentGateway } from './payment-gateway';

const planSelect = {
  code: true,
  name: true,
  description: true,
  priceMonthly: true,
  features: true,
} satisfies Prisma.PlanSelect;

const subscriptionInclude = {
  plan: { select: planSelect },
} satisfies Prisma.SubscriptionInclude;

/** Lo que falta para crear el negocio: se responde 402 (Payment Required) */
export class SubscriptionRequiredException extends HttpException {
  constructor(message = 'Primero activa tu suscripción para crear el negocio') {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        message,
        error: 'Payment Required',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/**
 * Suscripciones del SaaS. Cada negocio tiene una: se elige el plan y se paga
 * ANTES de crear el negocio (mientras tanto `businessId` es null) y al crear
 * el negocio se vincula. Reglas:
 * - Un usuario tiene a lo sumo una suscripción "suelta" (sin negocio) vigente.
 * - Los pagos pasan por `PaymentGateway` (hoy simulado).
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
  ) {}

  listPlans() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: planSelect,
    });
  }

  /** Suscripción suelta (sin negocio) del usuario: dice en qué paso va. */
  current(userId: string) {
    return this.prisma.subscription.findFirst({
      where: {
        userId,
        businessId: null,
        status: {
          in: [SubscriptionStatus.PENDING_PAYMENT, SubscriptionStatus.ACTIVE],
        },
      },
      include: subscriptionInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Elige (o cambia, si aún no paga) el plan de su próximo negocio. */
  async create(userId: string, planCode: PlanCode) {
    const plan = await this.prisma.plan.findFirst({
      where: { code: planCode, isActive: true },
    });
    if (!plan) throw new NotFoundException('Ese plan no está disponible');

    const existing = await this.current(userId);
    if (existing?.status === SubscriptionStatus.ACTIVE) {
      throw new ConflictException(
        'Ya tienes una suscripción pagada: completa los datos de tu negocio',
      );
    }
    if (existing) {
      return this.prisma.subscription.update({
        where: { id: existing.id },
        data: { planId: plan.id },
        include: subscriptionInclude,
      });
    }
    return this.prisma.subscription.create({
      data: { userId, planId: plan.id },
      include: subscriptionInclude,
    });
  }

  async pay(userId: string, subscriptionId: string, dto: PaySubscriptionDto) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { id: subscriptionId, userId, businessId: null },
      include: { plan: true },
    });
    if (!subscription) throw new NotFoundException('Suscripción no encontrada');
    if (subscription.status !== SubscriptionStatus.PENDING_PAYMENT) {
      throw new ConflictException('Esta suscripción ya está pagada');
    }

    const amount = subscription.plan.priceMonthly;
    const result = await this.gateway.charge({
      amount,
      description: `AgendaBarrio · plan ${subscription.plan.name} (1 mes)`,
      cardBrand: dto.cardBrand,
      cardLast4: dto.cardLast4,
      holderName: dto.holderName,
    });

    const payment = {
      subscriptionId,
      amount,
      provider: result.provider,
      reference: result.reference,
      cardBrand: dto.cardBrand,
      cardLast4: dto.cardLast4,
    };

    if (!result.approved) {
      await this.prisma.subscriptionPayment.create({
        data: {
          ...payment,
          status: PaymentStatus.DECLINED,
          failureReason: result.failureReason,
        },
      });
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          message: result.failureReason ?? 'El pago fue rechazado',
          error: 'Payment Required',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const now = new Date();
    const [, updated] = await this.prisma.$transaction([
      this.prisma.subscriptionPayment.create({
        data: { ...payment, status: PaymentStatus.APPROVED },
      }),
      this.prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: now,
          currentPeriodEnd: addMonths(now, 1),
        },
        include: subscriptionInclude,
      }),
    ]);
    return updated;
  }

  /** Suscripción de un negocio con su historial de pagos (panel del administrador). */
  async forBusiness(businessId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { businessId },
      include: {
        ...subscriptionInclude,
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 24,
          select: {
            id: true,
            amount: true,
            status: true,
            provider: true,
            reference: true,
            cardBrand: true,
            cardLast4: true,
            failureReason: true,
            createdAt: true,
          },
        },
      },
    });
    return subscription;
  }

  /**
   * Vincula al negocio recién creado la suscripción pagada del usuario. Se
   * llama dentro de la transacción que crea el negocio.
   */
  async attachToBusiness(
    tx: Prisma.TransactionClient,
    userId: string,
    businessId: string,
  ) {
    const subscription = await tx.subscription.findFirst({
      where: { userId, businessId: null, status: SubscriptionStatus.ACTIVE },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!subscription) throw new SubscriptionRequiredException();
    await tx.subscription.update({
      where: { id: subscription.id },
      data: { businessId },
    });
  }

  /** Verificación previa (sin transacción) para fallar antes de crear nada. */
  async assertCanCreateBusiness(userId: string) {
    const ready = await this.prisma.subscription.count({
      where: { userId, businessId: null, status: SubscriptionStatus.ACTIVE },
    });
    if (ready === 0) throw new SubscriptionRequiredException();
  }
}
