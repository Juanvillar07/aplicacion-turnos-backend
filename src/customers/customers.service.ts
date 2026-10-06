import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus, BusinessStatus, Prisma } from '@prisma/client';
import { normalizePhone } from '../common/utils/phone';
import { PrismaService } from '../prisma/prisma.service';
/** Datos de un cliente al reservar (web, panel o WhatsApp). */
export interface CustomerData {
  name: string;
  phone: string;
  /** Las reservas por WhatsApp pueden no traer correo */
  email?: string | null;
  /** undefined = no cambia la preferencia guardada */
  whatsappOptIn?: boolean;
}

export interface CustomerStats {
  /** Citas no canceladas (pendientes, confirmadas, completadas o no asistió) */
  appointmentsCount: number;
  completedCount: number;
  noShowCount: number;
  /** Suma de las citas completadas (COP) */
  totalSpent: number;
  lastVisitAt: Date | null;
  nextAppointmentAt: Date | null;
}

const PAGE_SIZE = 20;

const EMPTY_STATS: CustomerStats = {
  appointmentsCount: 0,
  completedCount: 0,
  noShowCount: 0,
  totalSpent: 0,
  lastVisitAt: null,
  nextAppointmentAt: null,
};

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * El celular identifica al cliente dentro del negocio: si ya existe se
   * actualizan su nombre y email con los datos más recientes.
   */
  upsertByPhone(
    businessId: string,
    input: CustomerData,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const phone = normalizePhone(input.phone);
    if (!phone) throw new BadRequestException('El celular no es válido');

    // Solo se actualiza lo que viene: un correo vacío no borra el guardado
    const optIn =
      input.whatsappOptIn === undefined
        ? {}
        : {
            whatsappOptIn: input.whatsappOptIn,
            whatsappOptInAt: input.whatsappOptIn ? new Date() : null,
          };
    return tx.customer.upsert({
      where: { businessId_phone: { businessId, phone } },
      update: {
        name: input.name,
        ...(input.email && { email: input.email }),
        ...optIn,
      },
      create: {
        businessId,
        phone,
        name: input.name,
        email: input.email ?? null,
        ...optIn,
      },
    });
  }

  /** Clientes con ese celular en negocios que reciben reservas por WhatsApp */
  findByPhoneAcrossBusinesses(phone: string) {
    return this.prisma.customer.findMany({
      where: {
        phone,
        business: { whatsappEnabled: true, status: BusinessStatus.ACTIVE },
      },
      include: { business: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** El cliente escribió "STOP": deja de recibir avisos de todos los negocios */
  optOutEverywhere(phone: string) {
    return this.prisma.customer.updateMany({
      where: { phone },
      data: { whatsappOptIn: false, whatsappOptInAt: null },
    });
  }

  /** Listado paginado con búsqueda por nombre, email o celular. */
  async list(businessId: string, term = '', page = 1) {
    const where = this.searchWhere(businessId, term);
    const [total, customers] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    const stats = await this.statsFor(customers.map((c) => c.id));
    return {
      items: customers.map((c) => ({
        ...c,
        ...(stats.get(c.id) ?? EMPTY_STATS),
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  /** Ficha del cliente con estadísticas e historial de citas. */
  async findOne(businessId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, businessId },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');

    const [stats, appointments] = await Promise.all([
      this.statsFor([customerId]),
      this.prisma.appointment.findMany({
        where: { customerId, businessId },
        include: {
          service: { select: { name: true } },
          resource: { select: { name: true } },
        },
        orderBy: { startsAt: 'desc' },
        take: 100,
      }),
    ]);
    return {
      ...customer,
      ...(stats.get(customerId) ?? EMPTY_STATS),
      appointments,
    };
  }

  async updateNotes(
    businessId: string,
    customerId: string,
    notes: string | null,
  ) {
    const { count } = await this.prisma.customer.updateMany({
      where: { id: customerId, businessId },
      data: { notes: notes?.trim() || null },
    });
    if (count === 0) throw new NotFoundException('Cliente no encontrado');
    return this.findOne(businessId, customerId);
  }

  private searchWhere(
    businessId: string,
    term: string,
  ): Prisma.CustomerWhereInput {
    const q = term.trim();
    const digits = q.replace(/\D/g, '');
    return {
      businessId,
      ...(q && {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        ],
      }),
    };
  }

  /** Estadísticas de varios clientes en dos consultas agregadas. */
  private async statsFor(customerIds: string[]) {
    const result = new Map<string, CustomerStats>();
    if (customerIds.length === 0) return result;

    const [byStatus, upcoming] = await Promise.all([
      this.prisma.appointment.groupBy({
        by: ['customerId', 'status'],
        where: { customerId: { in: customerIds } },
        _count: true,
        _sum: { price: true },
        _max: { startsAt: true },
      }),
      this.prisma.appointment.groupBy({
        by: ['customerId'],
        where: {
          customerId: { in: customerIds },
          startsAt: { gte: new Date() },
          status: {
            in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED],
          },
        },
        _min: { startsAt: true },
      }),
    ]);

    for (const row of byStatus) {
      const s = result.get(row.customerId) ?? { ...EMPTY_STATS };
      if (row.status !== AppointmentStatus.CANCELLED)
        s.appointmentsCount += row._count;
      if (row.status === AppointmentStatus.NO_SHOW) s.noShowCount += row._count;
      if (row.status === AppointmentStatus.COMPLETED) {
        s.completedCount += row._count;
        s.totalSpent += row._sum.price ?? 0;
        s.lastVisitAt = row._max.startsAt;
      }
      result.set(row.customerId, s);
    }
    for (const row of upcoming) {
      const s = result.get(row.customerId) ?? { ...EMPTY_STATS };
      s.nextAppointmentAt = row._min.startsAt;
      result.set(row.customerId, s);
    }
    return result;
  }
}
