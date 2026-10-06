/**
 * Datos de demostración para desarrollo local.
 *   Usuario: demo@agendabarrio.co   Contraseña: demo12345
 * Ejecutar con: npm run db:seed   (idempotente: borra y recrea el negocio demo)
 */
import {
  AppointmentSource,
  AppointmentStatus,
  BusinessCategory,
  MemberRole,
  PlanCode,
  PrismaClient,
  ResourceType,
  SubscriptionStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import {
  addDays,
  dayOfWeek,
  localTimeToUtc,
  toLocalDate,
} from '../src/availability/time.utils';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@agendabarrio.co';
const DEMO_PASSWORD = 'demo12345';
const DEMO_SLUG = 'barberia-don-juan';

const TZ = 'America/Bogota';
const h = (hh: number, mm = 0) => hh * 60 + mm;

/** Próximo día de atención (lunes a sábado) a partir de `date`, incluido. */
function nextOpenDay(date: string): string {
  return dayOfWeek(date) === 0 ? addDays(date, 1) : date;
}

/** Lunes a sábado: 9:00–13:00 y 14:00–19:00 */
const weekdaySchedule = [1, 2, 3, 4, 5, 6].flatMap((dayOfWeek) => [
  { dayOfWeek, startMinute: h(9), endMinute: h(13) },
  { dayOfWeek, startMinute: h(14), endMinute: h(19) },
]);

async function main() {
  const password = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { emailVerifiedAt: new Date() },
    create: {
      email: DEMO_EMAIL,
      name: 'Juan Pérez',
      password,
      emailVerifiedAt: new Date(),
    },
  });

  // Borra los negocios del usuario demo (aunque les hayan cambiado el enlace)
  // y cualquier otro que use el enlace demo, para recrearlo limpio.
  await prisma.business.deleteMany({
    where: {
      OR: [
        { slug: DEMO_SLUG },
        { memberships: { some: { userId: user.id, role: MemberRole.ADMIN } } },
      ],
    },
  });

  // Sus suscripciones también (las de negocios borrados quedarían sueltas)
  await prisma.subscription.deleteMany({ where: { userId: user.id } });

  const business = await prisma.business.create({
    data: {
      name: 'Barbería Don Juan',
      slug: DEMO_SLUG,
      category: BusinessCategory.BARBERSHOP,
      phone: '3001234567',
      address: 'Cra 45 # 23-10',
      city: 'Medellín',
      memberships: { create: { userId: user.id, role: MemberRole.ADMIN } },
    },
  });

  // Plan Pro de cortesía por un año (los planes los crea la migración)
  const now = new Date();
  const pro = await prisma.plan.findUniqueOrThrow({
    where: { code: PlanCode.PRO },
  });
  await prisma.subscription.create({
    data: {
      userId: user.id,
      businessId: business.id,
      planId: pro.id,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 365 * 24 * 60 * 60_000),
      isComplimentary: true,
    },
  });

  const [corte, barba, combo] = await Promise.all([
    prisma.service.create({
      data: {
        businessId: business.id,
        name: 'Corte clásico',
        durationMinutes: 30,
        price: 20000,
      },
    }),
    prisma.service.create({
      data: {
        businessId: business.id,
        name: 'Arreglo de barba',
        durationMinutes: 20,
        price: 12000,
      },
    }),
    prisma.service.create({
      data: {
        businessId: business.id,
        name: 'Corte + barba',
        description:
          'Corte a elección y perfilado de barba con toalla caliente',
        durationMinutes: 50,
        price: 28000,
      },
    }),
  ]);

  const barbers = [
    { name: 'Carlos', serviceIds: [corte.id, barba.id, combo.id] },
    { name: 'Andrés', serviceIds: [corte.id, combo.id] },
  ];

  const created = [];
  for (const barber of barbers) {
    const resource = await prisma.resource.create({
      data: {
        businessId: business.id,
        name: barber.name,
        type: ResourceType.PERSON,
        services: {
          create: barber.serviceIds.map((serviceId) => ({ serviceId })),
        },
        workingHours: { create: weekdaySchedule },
      },
    });
    created.push(resource);
  }

  // ─── Clientes, citas y un bloqueo de ejemplo ───
  const customers = await Promise.all(
    [
      {
        name: 'Mateo Restrepo',
        email: 'mateo@example.com',
        phone: '+573001112233',
      },
      {
        name: 'Santiago Gómez',
        email: 'santiago@example.com',
        phone: '+573104445566',
      },
      {
        name: 'Valentina Ríos',
        email: 'valentina@example.com',
        phone: '+573207778899',
      },
    ].map((c) =>
      prisma.customer.create({ data: { ...c, businessId: business.id } }),
    ),
  );

  const day1 = nextOpenDay(toLocalDate(new Date(), TZ));
  const day2 = nextOpenDay(addDays(day1, 1));
  const appointments = [
    {
      day: day1,
      at: h(9),
      resource: 0,
      service: corte,
      customer: 0,
      status: AppointmentStatus.CONFIRMED,
    },
    {
      day: day1,
      at: h(10),
      resource: 1,
      service: combo,
      customer: 1,
      status: AppointmentStatus.CONFIRMED,
    },
    {
      day: day1,
      at: h(15),
      resource: 0,
      service: barba,
      customer: 2,
      status: AppointmentStatus.PENDING,
    },
    {
      day: day2,
      at: h(11),
      resource: 1,
      service: corte,
      customer: 0,
      status: AppointmentStatus.PENDING,
    },
  ];
  for (const a of appointments) {
    const startsAt = localTimeToUtc(a.day, a.at, TZ);
    await prisma.appointment.create({
      data: {
        businessId: business.id,
        resourceId: created[a.resource].id,
        serviceId: a.service.id,
        customerId: customers[a.customer].id,
        startsAt,
        endsAt: new Date(
          startsAt.getTime() + a.service.durationMinutes * 60_000,
        ),
        status: a.status,
        price: a.service.price,
        source: AppointmentSource.WEB,
        manageToken: randomBytes(24).toString('base64url'),
      },
    });
  }

  await prisma.timeOff.create({
    data: {
      businessId: business.id,
      resourceId: created[1].id,
      startsAt: localTimeToUtc(day1, h(16), TZ),
      endsAt: localTimeToUtc(day1, h(18), TZ),
      reason: 'Diligencia personal',
    },
  });

  console.log(
    `Seed listo → ${DEMO_EMAIL} / ${DEMO_PASSWORD} · negocio "${business.name}"`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
