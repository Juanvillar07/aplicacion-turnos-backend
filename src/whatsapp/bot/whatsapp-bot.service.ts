import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { TZDate } from '@date-fns/tz';
import {
  AppointmentSource,
  AppointmentStatus,
  Business,
  BusinessStatus,
  Prisma,
} from '@prisma/client';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AppointmentsService } from '../../appointments/appointments.service';
import { AvailabilityService } from '../../availability/availability.service';
import { toLocalDate } from '../../availability/time.utils';
import { normalizePhone } from '../../common/utils/phone';
import { CustomersService } from '../../customers/customers.service';
import { formatWhen } from '../../mail/templates/appointment.templates';
import { PrismaService } from '../../prisma/prisma.service';
import { InboundMessage, OutgoingMessage } from '../whatsapp.types';

type Step =
  | 'pick_business'
  | 'menu'
  | 'service'
  | 'resource'
  | 'day'
  | 'slot'
  | 'phone'
  | 'name'
  | 'email'
  | 'confirm'
  | 'my_appts'
  | 'appt'
  | 'confirm_cancel';

/** Estado de la conversación, guardado como JSON en whatsapp_sessions */
interface BotState {
  step?: Step;
  serviceId?: string;
  /** null = cualquiera disponible */
  resourceId?: string | null;
  date?: string;
  dayOffset?: number;
  slotOffset?: number;
  startsAt?: string;
  name?: string;
  email?: string | null;
  apptId?: string;
  /** Datos del cliente que sobreviven a los reinicios de la conversación */
  identity?: Identity;
}

/**
 * Quién escribe. Si Meta oculta el número (cliente con nombre de usuario), el
 * celular lo escribe el propio cliente y no está verificado: en ese caso
 * "Mis citas" solo muestra las citas reservadas desde este chat.
 */
interface Identity {
  phone?: string;
  verified?: boolean;
  /** Citas reservadas desde este chat (las últimas) */
  apptIds?: string[];
}

interface Ctx {
  msg: InboundMessage;
  identity: Identity;
  /** Texto normalizado: minúsculas, sin tildes, sin espacios sobrantes */
  text: string;
  state: BotState;
  businessId: string | null;
  out: OutgoingMessage[];
}

/** Una conversación abandonada por más de este tiempo vuelve a empezar */
const SESSION_TTL_MS = 30 * 60_000;
const PAGE = 9;
const RESET_WORDS = new Set([
  'menu',
  'inicio',
  'hola',
  'ayuda',
  'volver',
  'empezar',
]);
const CANCEL_WORDS = new Set(['cancelar', 'salir']);
const STOP_WORDS = new Set(['stop', 'baja', 'parar', 'no mas mensajes']);
const SKIP_WORDS = new Set(['no', 'omitir', 'ninguno', 'no tengo', 'saltar']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalize = (s = '') =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[¡!¿?.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const firstName = (name: string) => name.split(' ')[0];
const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Bot de reservas por WhatsApp. Es una máquina de estados por número de
 * celular: recibe un mensaje (texto o toque de botón/lista) y devuelve los
 * mensajes a responder. No envía nada: eso lo hace quien lo llama (webhook o
 * simulador), así se puede probar sin la API de Meta.
 */
@Injectable()
export class WhatsappBotService {
  private readonly logger = new Logger(WhatsappBotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly appointments: AppointmentsService,
    private readonly customers: CustomersService,
  ) {}

  async handle(msg: InboundMessage): Promise<{
    messages: OutgoingMessage[];
    businessId: string | null;
  }> {
    const session = await this.prisma.whatsappSession.upsert({
      where: { phone: msg.from },
      update: {},
      create: { phone: msg.from },
    });
    const stale = Date.now() - session.updatedAt.getTime() > SESSION_TTL_MS;
    const saved = (session.state ?? {}) as BotState;
    const { identity: savedIdentity = {}, ...savedState } = saved;
    const ctx: Ctx = {
      msg,
      identity: msg.phone
        ? { ...savedIdentity, phone: msg.phone, verified: true }
        : savedIdentity,
      text: normalize(msg.text),
      state: stale ? {} : savedState,
      businessId: session.businessId,
      out: [],
    };

    try {
      await this.route(ctx);
    } catch (error) {
      this.logger.error(
        `Error del bot con ${msg.from}: ${(error as Error).message}`,
      );
      ctx.out.push({
        kind: 'text',
        text: 'Uy, algo salió mal de nuestro lado 😕. Escribe *menú* para empezar de nuevo.',
      });
      ctx.state = {};
    }

    await this.prisma.whatsappSession.update({
      where: { phone: msg.from },
      data: {
        businessId: ctx.businessId,
        state: {
          ...ctx.state,
          identity: ctx.identity,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return { messages: ctx.out, businessId: ctx.businessId };
  }

  // ─── Enrutamiento ────────────────────────────────────────

  private async route(ctx: Ctx) {
    const { text, msg } = ctx;
    const reply = msg.replyId;

    if (!reply && STOP_WORDS.has(text)) {
      if (ctx.identity.phone)
        await this.customers.optOutEverywhere(ctx.identity.phone);
      ctx.state = {};
      ctx.out.push({
        kind: 'text',
        text: 'Listo, no te enviaremos más avisos por WhatsApp. Si quieres reservar, escríbenos cuando quieras.',
      });
      return;
    }

    // Selección de negocio (botón de lista) o "Otro negocio"
    if (reply?.startsWith('biz:'))
      return this.selectBusiness(ctx, reply.slice(4));
    if (reply === 'switch') {
      ctx.businessId = null;
      ctx.state = { step: 'pick_business' };
      return this.askBusiness(ctx);
    }

    // El mensaje trae el enlace de un negocio (botón "Reservar por WhatsApp")
    if (!reply && ctx.text) {
      const linked = await this.businessInText(ctx.text);
      if (linked && linked.id !== ctx.businessId)
        return this.selectBusiness(ctx, linked.id);
    }

    const business = ctx.businessId
      ? await this.findBusiness(ctx.businessId)
      : null;
    if (!business) {
      ctx.businessId = null;
      return this.resolveBusiness(ctx);
    }

    // Palabras para volver al inicio
    const awaitingText =
      ctx.state.step === 'phone' ||
      ctx.state.step === 'name' ||
      ctx.state.step === 'email';
    if (
      !reply &&
      (RESET_WORDS.has(text) || (CANCEL_WORDS.has(text) && !awaitingText))
    ) {
      ctx.state = { step: 'menu' };
      return this.menu(ctx, business);
    }

    if (reply) return this.onReply(ctx, business, reply);
    return this.onText(ctx, business);
  }

  private async onReply(ctx: Ctx, business: Business, reply: string) {
    const [action, value] = [
      reply.split(':')[0],
      reply.split(':').slice(1).join(':'),
    ];
    const s = ctx.state;
    switch (action) {
      case 'menu':
        ctx.state = { step: 'menu' };
        return this.menu(ctx, business);
      case 'book':
        ctx.state = { step: 'service' };
        return this.askService(ctx, business);
      case 'mine':
        return this.myAppointments(ctx, business);
      case 'svc':
        ctx.state = { step: 'resource', serviceId: value };
        return this.askResource(ctx, business);
      case 'res':
        ctx.state = {
          ...s,
          step: 'day',
          resourceId: value === 'any' ? null : value,
          dayOffset: 0,
        };
        return this.askDay(ctx, business);
      case 'days':
        ctx.state = { ...s, dayOffset: (s.dayOffset ?? 0) + PAGE };
        return this.askDay(ctx, business);
      case 'day':
        ctx.state = { ...s, step: 'slot', date: value, slotOffset: 0 };
        return this.askSlot(ctx, business);
      case 'slots':
        ctx.state = { ...s, slotOffset: (s.slotOffset ?? 0) + PAGE };
        return this.askSlot(ctx, business);
      case 'slot':
        ctx.state = { ...s, startsAt: value };
        return this.askCustomerData(ctx, business);
      case 'confirm':
        return this.book(ctx, business);
      case 'appt':
        ctx.state = { step: 'appt', apptId: value };
        return this.showAppointment(ctx, business);
      case 'appt_cancel':
        ctx.state = { ...s, step: 'confirm_cancel' };
        ctx.out.push({
          kind: 'buttons',
          text: '¿Seguro que quieres cancelar esta cita? El horario quedará libre.',
          buttons: [
            { id: 'cancel_yes', title: 'Sí, cancelar' },
            { id: 'menu', title: 'No, volver' },
          ],
        });
        return;
      case 'cancel_yes':
        return this.cancelAppointment(ctx, business);
      case 'appt_reschedule':
        return this.rescheduleLink(ctx, business);
      default:
        return this.repeatStep(ctx, business);
    }
  }

  /** Texto libre: solo se espera en los pasos de nombre, correo o búsqueda. */
  private async onText(ctx: Ctx, business: Business) {
    const raw = (ctx.msg.text ?? '').trim();
    switch (ctx.state.step) {
      case 'phone': {
        const phone = normalizePhone(raw);
        if (!phone) {
          ctx.out.push({
            kind: 'text',
            text: 'Ese número no parece válido. Escríbelo con 10 dígitos, por ejemplo *300 123 4567*.',
          });
          return;
        }
        ctx.identity = { ...ctx.identity, phone, verified: false };
        return this.askCustomerData(ctx, business);
      }
      case 'name':
        if (raw.length < 2 || raw.length > 80) {
          ctx.out.push({
            kind: 'text',
            text: 'Escribe tu nombre, por favor (por ejemplo: *Laura Gómez*).',
          });
          return;
        }
        ctx.state = { ...ctx.state, step: 'email', name: raw };
        ctx.out.push({
          kind: 'text',
          text: `Gracias, ${firstName(raw)}. ¿Cuál es tu correo? Te enviaremos ahí también la confirmación.\n\nSi prefieres no darlo, escribe *no*.`,
        });
        return;
      case 'email':
        if (SKIP_WORDS.has(ctx.text)) {
          ctx.state = { ...ctx.state, email: null };
        } else if (EMAIL.test(raw)) {
          ctx.state = { ...ctx.state, email: raw.toLowerCase() };
        } else {
          ctx.out.push({
            kind: 'text',
            text: 'Ese correo no parece válido. Escríbelo de nuevo o responde *no* para omitirlo.',
          });
          return;
        }
        return this.askConfirm(ctx, business);
      default:
        return this.repeatStep(ctx, business);
    }
  }

  // ─── Negocio ─────────────────────────────────────────────

  private findBusiness(id: string) {
    return this.prisma.business.findFirst({
      where: { id, whatsappEnabled: true, status: BusinessStatus.ACTIVE },
    });
  }

  /** Detecta el negocio por su enlace, por reservas anteriores o por búsqueda. */
  private async resolveBusiness(ctx: Ctx) {
    // 1. Está escribiendo el nombre del negocio que busca
    if (
      ctx.state.step === 'pick_business' &&
      ctx.text &&
      !RESET_WORDS.has(ctx.text)
    ) {
      const found = await this.prisma.business.findMany({
        where: {
          whatsappEnabled: true,
          status: BusinessStatus.ACTIVE,
          name: { contains: (ctx.msg.text ?? '').trim(), mode: 'insensitive' },
        },
        take: 10,
        orderBy: { name: 'asc' },
      });
      if (found.length === 1) return this.selectBusiness(ctx, found[0].id);
      if (found.length > 1) {
        ctx.out.push({
          kind: 'list',
          text: 'Encontré estos negocios. ¿Cuál es?',
          button: 'Ver negocios',
          rows: found.map((b) => ({
            id: `biz:${b.id}`,
            title: b.name,
            description: b.city ?? undefined,
          })),
        });
        return;
      }
      ctx.out.push({
        kind: 'text',
        text: `No encontré negocios con "${(ctx.msg.text ?? '').trim()}" 🤔. Revisa el nombre o pídele al negocio su enlace de WhatsApp.`,
      });
      return;
    }

    // 2. Ya reservó antes en uno o varios negocios
    const { phone, verified } = ctx.identity;
    const known =
      phone && verified
        ? await this.customers.findByPhoneAcrossBusinesses(phone)
        : [];
    const unique = [
      ...new Map(known.map((c) => [c.business.id, c.business])).values(),
    ];
    if (unique.length === 1) return this.selectBusiness(ctx, unique[0].id);
    if (unique.length > 1) {
      ctx.state = { step: 'pick_business' };
      ctx.out.push({
        kind: 'list',
        text: `¡Hola${ctx.msg.profileName ? `, ${firstName(ctx.msg.profileName)}` : ''}! 👋 ¿Con qué negocio quieres agendar?`,
        button: 'Ver negocios',
        rows: unique
          .slice(0, 10)
          .map((b) => ({ id: `biz:${b.id}`, title: b.name })),
      });
      return;
    }

    ctx.state = { step: 'pick_business' };
    return this.askBusiness(ctx);
  }

  /** Busca el enlace (slug) de un negocio entre las palabras del mensaje */
  private businessInText(text: string) {
    const words = text.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
    if (words.length === 0) return null;
    return this.prisma.business.findFirst({
      where: {
        slug: { in: words },
        whatsappEnabled: true,
        status: BusinessStatus.ACTIVE,
      },
    });
  }

  private askBusiness(ctx: Ctx) {
    ctx.out.push({
      kind: 'text',
      text: `¡Hola${ctx.msg.profileName ? `, ${firstName(ctx.msg.profileName)}` : ''}! 👋 Soy el asistente de reservas de *AgendaBarrio*.\n\n¿En qué negocio quieres agendar? Escribe su nombre.`,
    });
  }

  private async selectBusiness(ctx: Ctx, businessId: string) {
    const business = await this.findBusiness(businessId);
    if (!business) {
      ctx.state = { step: 'pick_business' };
      return this.askBusiness(ctx);
    }
    ctx.businessId = business.id;
    ctx.state = { step: 'menu' };
    return this.menu(ctx, business);
  }

  private menu(ctx: Ctx, business: Business) {
    ctx.out.push({
      kind: 'buttons',
      text: `Estás con *${business.name}*\n\n¿Qué quieres hacer?`,
      buttons: [
        { id: 'book', title: 'Reservar cita' },
        { id: 'mine', title: 'Mis citas' },
        { id: 'switch', title: 'Otro negocio' },
      ],
    });
  }

  // ─── Reservar ────────────────────────────────────────────

  private async askService(ctx: Ctx, business: Business) {
    const services = await this.prisma.service.findMany({
      where: {
        businessId: business.id,
        isActive: true,
        resources: {
          some: { resource: { isActive: true, workingHours: { some: {} } } },
        },
      },
      orderBy: { name: 'asc' },
      take: 10,
    });
    if (services.length === 0) {
      ctx.state = { step: 'menu' };
      ctx.out.push({
        kind: 'text',
        text: `${business.name} aún no tiene servicios para reservar en línea.`,
      });
      return;
    }
    ctx.out.push({
      kind: 'list',
      text: '¿Qué servicio quieres?',
      button: 'Ver servicios',
      rows: services.map((s) => ({
        id: `svc:${s.id}`,
        title: s.name,
        description: `${s.durationMinutes} min · ${cop.format(s.price)}`,
      })),
    });
  }

  private async askResource(ctx: Ctx, business: Business) {
    const providers = await this.prisma.resource.findMany({
      where: {
        businessId: business.id,
        isActive: true,
        workingHours: { some: {} },
        services: { some: { serviceId: ctx.state.serviceId } },
      },
      orderBy: { name: 'asc' },
    });
    if (providers.length === 0) {
      ctx.state = { step: 'service' };
      ctx.out.push({
        kind: 'text',
        text: 'Ese servicio no está disponible ahora. Elige otro:',
      });
      return this.askService(ctx, business);
    }
    if (providers.length === 1) {
      ctx.state = {
        ...ctx.state,
        step: 'day',
        resourceId: providers[0].id,
        dayOffset: 0,
      };
      return this.askDay(ctx, business);
    }
    ctx.out.push({
      kind: 'list',
      text: '¿Con quién?',
      button: 'Elegir',
      rows: [
        {
          id: 'res:any',
          title: 'Cualquiera disponible',
          description: 'Te mostramos todos los horarios',
        },
        ...providers
          .slice(0, 9)
          .map((r) => ({ id: `res:${r.id}`, title: r.name })),
      ],
    });
  }

  private async askDay(ctx: Ctx, business: Business) {
    const { serviceId, resourceId, dayOffset = 0 } = ctx.state;
    const days = await this.availability.daysWithAvailability({
      business,
      serviceId: serviceId!,
      resourceId: resourceId ?? null,
    });
    if (days.length === 0) {
      ctx.state = { step: 'menu' };
      ctx.out.push({
        kind: 'text',
        text: `No hay horarios disponibles en los próximos ${business.maxDaysAhead} días 😕.`,
      });
      return this.menu(ctx, business);
    }
    const today = toLocalDate(new Date(), business.timezone);
    const page = days.slice(dayOffset, dayOffset + PAGE);
    ctx.out.push({
      kind: 'list',
      text: '¿Qué día te queda bien?',
      button: 'Ver días',
      rows: [
        ...page.map((d) => ({
          id: `day:${d}`,
          title: this.dayTitle(d, business.timezone),
          description: d === today ? 'Hoy' : undefined,
        })),
        ...(days.length > dayOffset + PAGE
          ? [{ id: 'days:more', title: 'Ver más días ➡️' }]
          : []),
      ],
    });
  }

  private async askSlot(ctx: Ctx, business: Business) {
    const { serviceId, resourceId, date, slotOffset = 0 } = ctx.state;
    const { slots } = await this.availability.getSlots({
      business,
      serviceId: serviceId!,
      resourceId: resourceId ?? null,
      date: date!,
    });
    if (slots.length === 0) {
      ctx.state = { ...ctx.state, step: 'day', dayOffset: 0 };
      ctx.out.push({
        kind: 'text',
        text: 'Ya no quedan horarios ese día. Elige otro:',
      });
      return this.askDay(ctx, business);
    }
    const page = slots.slice(slotOffset, slotOffset + PAGE);
    ctx.out.push({
      kind: 'list',
      text: `${this.dayTitle(date!, business.timezone)}: ¿a qué hora?`,
      button: 'Ver horarios',
      rows: [
        ...page.map((s) => ({
          id: `slot:${s.startsAt.toISOString()}`,
          title: format(
            new TZDate(s.startsAt.getTime(), business.timezone),
            'h:mm aaa',
            { locale: es },
          ),
        })),
        ...(slots.length > slotOffset + PAGE
          ? [{ id: 'slots:more', title: 'Más tarde ➡️' }]
          : []),
      ],
    });
  }

  /** Si ya es cliente del negocio se usan sus datos; si no, se le preguntan. */
  private async askCustomerData(ctx: Ctx, business: Business) {
    const { phone, verified } = ctx.identity;
    if (!phone) {
      // Meta no nos dio su número (usa nombre de usuario): se lo pedimos
      ctx.state = { ...ctx.state, step: 'phone' };
      ctx.out.push({
        kind: 'text',
        text: '¿Cuál es tu número de celular? Lo usamos para identificar tu reserva (por ejemplo: *300 123 4567*).',
      });
      return;
    }
    // Con un número escrito a mano no se muestran datos de otra persona
    const existing = verified
      ? await this.prisma.customer.findUnique({
          where: { businessId_phone: { businessId: business.id, phone } },
        })
      : null;
    if (existing) {
      ctx.state = { ...ctx.state, name: existing.name, email: existing.email };
      return this.askConfirm(ctx, business);
    }
    ctx.state = { ...ctx.state, step: 'name' };
    ctx.out.push({
      kind: 'text',
      text: '¿A nombre de quién hacemos la reserva?',
    });
  }

  private async askConfirm(ctx: Ctx, business: Business) {
    const { serviceId, resourceId, startsAt, name } = ctx.state;
    const [service, resource] = await Promise.all([
      this.prisma.service.findUnique({ where: { id: serviceId } }),
      resourceId
        ? this.prisma.resource.findUnique({ where: { id: resourceId } })
        : null,
    ]);
    ctx.state = { ...ctx.state, step: 'confirm' };
    ctx.out.push({
      kind: 'buttons',
      text: [
        '¿Confirmamos tu reserva?',
        '',
        `👤 ${name}`,
        `📌 ${service?.name} · ${service ? cop.format(service.price) : ''}`,
        `📅 ${formatWhen(new Date(startsAt!), business.timezone)}`,
        `🙋 ${resource?.name ?? 'Cualquiera disponible'}`,
        `📍 ${business.name}`,
      ].join('\n'),
      buttons: [
        { id: 'confirm', title: 'Confirmar' },
        { id: 'menu', title: 'Cancelar' },
      ],
    });
  }

  private async book(ctx: Ctx, business: Business) {
    const { serviceId, resourceId, startsAt, name, email } = ctx.state;
    const phone = ctx.identity.phone;
    if (
      ctx.state.step !== 'confirm' ||
      !serviceId ||
      !startsAt ||
      !name ||
      !phone
    ) {
      return this.repeatStep(ctx, business);
    }
    try {
      const appt = await this.appointments.book({
        business,
        serviceId,
        resourceId: resourceId ?? null,
        startsAt: new Date(startsAt),
        customer: { name, phone, email, whatsappOptIn: true },
        source: AppointmentSource.WHATSAPP,
      });
      ctx.identity = {
        ...ctx.identity,
        apptIds: [...(ctx.identity.apptIds ?? []), appt.id].slice(-20),
      };
      const pending = appt.status === AppointmentStatus.PENDING;
      ctx.state = { step: 'menu' };
      ctx.out.push({
        kind: 'text',
        text: [
          pending
            ? `📝 ¡Listo, ${firstName(name)}! Recibimos tu solicitud. ${business.name} la confirmará pronto y te avisaremos por aquí.`
            : `✅ ¡Listo, ${firstName(name)}! Tu cita quedó confirmada.`,
          '',
          `📅 ${formatWhen(appt.startsAt, business.timezone)}`,
          `📌 ${appt.service.name} con ${appt.resource.name}`,
          '',
          `Para ver, reprogramar o cancelar: ${this.manageUrl(appt.manageToken)}`,
        ].join('\n'),
      });
      ctx.out.push({
        kind: 'buttons',
        text: '¿Necesitas algo más?',
        buttons: [
          { id: 'book', title: 'Otra cita' },
          { id: 'mine', title: 'Mis citas' },
        ],
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        ctx.state = {
          ...ctx.state,
          step: 'slot',
          slotOffset: 0,
          startsAt: undefined,
        };
        ctx.out.push({
          kind: 'text',
          text: 'Ese horario se acaba de ocupar 😕. Elige otro:',
        });
        return this.askSlot(ctx, business);
      }
      if (error instanceof BadRequestException) {
        ctx.state = { step: 'menu' };
        ctx.out.push({
          kind: 'text',
          text: (error.getResponse() as { message: string }).message,
        });
        return this.menu(ctx, business);
      }
      throw error;
    }
  }

  // ─── Mis citas ───────────────────────────────────────────

  private async myAppointments(ctx: Ctx, business: Business) {
    const upcoming = await this.prisma.appointment.findMany({
      where: {
        businessId: business.id,
        ...this.ownAppointmentsFilter(ctx),
        status: {
          in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED],
        },
        startsAt: { gte: new Date() },
      },
      include: { service: true, resource: true },
      orderBy: { startsAt: 'asc' },
      take: 9,
    });
    if (upcoming.length === 0) {
      ctx.state = { step: 'menu' };
      ctx.out.push({
        kind: 'buttons',
        text: `No tienes citas próximas en ${business.name}.`,
        buttons: [
          { id: 'book', title: 'Reservar cita' },
          { id: 'switch', title: 'Otro negocio' },
        ],
      });
      return;
    }
    ctx.state = { step: 'my_appts' };
    ctx.out.push({
      kind: 'list',
      text: 'Tus próximas citas:',
      button: 'Ver citas',
      rows: upcoming.map((a) => ({
        id: `appt:${a.id}`,
        title: capitalize(
          format(
            new TZDate(a.startsAt.getTime(), business.timezone),
            'EEE d MMM h:mm aaa',
            { locale: es },
          ),
        ),
        description: `${a.service.name} con ${a.resource.name}${a.status === AppointmentStatus.PENDING ? ' · por confirmar' : ''}`,
      })),
    });
  }

  /**
   * Citas que puede ver quien escribe: las de su celular si Meta lo envió;
   * si no, solo las que reservó desde este chat.
   */
  private ownAppointmentsFilter(ctx: Ctx): Prisma.AppointmentWhereInput {
    const { phone, verified, apptIds = [] } = ctx.identity;
    if (phone && verified) return { customer: { phone } };
    return { id: { in: apptIds } };
  }

  /** Cita del propio cliente (se verifica que el celular coincida). */
  private findOwnAppointment(ctx: Ctx, business: Business) {
    return this.prisma.appointment.findFirst({
      where: {
        AND: [{ id: ctx.state.apptId }, this.ownAppointmentsFilter(ctx)],
        businessId: business.id,
      },
      include: { service: true, resource: true },
    });
  }

  private async showAppointment(ctx: Ctx, business: Business) {
    const appt = await this.findOwnAppointment(ctx, business);
    if (!appt) return this.myAppointments(ctx, business);
    ctx.out.push({
      kind: 'buttons',
      text: `📅 ${formatWhen(appt.startsAt, business.timezone)}\n📌 ${appt.service.name} con ${appt.resource.name}\n\n¿Qué quieres hacer?`,
      buttons: [
        { id: 'appt_reschedule', title: 'Reprogramar' },
        { id: 'appt_cancel', title: 'Cancelar cita' },
        { id: 'menu', title: 'Volver' },
      ],
    });
  }

  private async cancelAppointment(ctx: Ctx, business: Business) {
    const appt = await this.findOwnAppointment(ctx, business);
    ctx.state = { step: 'menu' };
    if (!appt) return this.myAppointments(ctx, business);
    try {
      await this.appointments.cancelByToken(appt.manageToken, {
        skipCustomerWhatsapp: true,
      });
      ctx.out.push({
        kind: 'text',
        text: 'Tu cita fue cancelada ✅. El horario quedó libre.',
      });
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      ctx.out.push({
        kind: 'text',
        text: 'Esta cita ya no se puede cancelar en línea. Comunícate con el negocio.',
      });
    }
    return this.menu(ctx, business);
  }

  private async rescheduleLink(ctx: Ctx, business: Business) {
    const appt = await this.findOwnAppointment(ctx, business);
    ctx.state = { step: 'menu' };
    if (!appt) return this.myAppointments(ctx, business);
    ctx.out.push({
      kind: 'text',
      text: `Puedes elegir el nuevo horario aquí 👇\n${this.manageUrl(appt.manageToken)}`,
    });
  }

  // ─── Auxiliares ──────────────────────────────────────────

  /** El cliente escribió algo inesperado: se repite la pregunta del paso actual. */
  private async repeatStep(ctx: Ctx, business: Business) {
    const hint = (text: string) =>
      ctx.out.push({
        kind: 'text',
        text: `${text} (o escribe *menú* para empezar de nuevo)`,
      });
    switch (ctx.state.step) {
      case 'service':
        hint('Elige un servicio de la lista 👇');
        return this.askService(ctx, business);
      case 'resource':
        hint('Elige con quién 👇');
        return this.askResource(ctx, business);
      case 'day':
        hint('Elige un día de la lista 👇');
        return this.askDay(ctx, business);
      case 'slot':
        hint('Elige una hora de la lista 👇');
        return this.askSlot(ctx, business);
      case 'confirm':
        return this.askConfirm(ctx, business);
      default:
        ctx.state = { step: 'menu' };
        return this.menu(ctx, business);
    }
  }

  private dayTitle(date: string, timezone: string) {
    const [y, m, d] = date.split('-').map(Number);
    return capitalize(
      format(new TZDate(y, m - 1, d, 12, 0, 0, timezone), "EEEE d 'de' MMM", {
        locale: es,
      }),
    );
  }

  private manageUrl(token: string) {
    return `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/cita/${token}`;
  }
}
