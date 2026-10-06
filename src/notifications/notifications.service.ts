import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentSource, AppointmentStatus } from '@prisma/client';
import { MANAGER_ROLES } from '../common/tenancy/roles';
import { toLocalDate } from '../availability/time.utils';
import { MailService } from '../mail/mail.service';
import type { RenderedEmail } from '../mail/templates/layout';
import {
  AppointmentEmailData,
  bookingApprovedTemplate,
  bookingCancelledTemplate,
  bookingConfirmedTemplate,
  bookingReceivedTemplate,
  bookingRescheduledTemplate,
  businessCancelledTemplate,
  businessNewBookingTemplate,
  businessRescheduledTemplate,
  formatWhen,
} from '../mail/templates/appointment.templates';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import {
  fillTemplate,
  WHATSAPP_TEMPLATES,
  WhatsappTemplateKey,
} from '../whatsapp/whatsapp.templates';

export type AppointmentEvent =
  /** Cita creada (web, panel o WhatsApp) */
  | { kind: 'created' }
  /** El negocio confirmó una reserva pendiente */
  | { kind: 'approved' }
  | { kind: 'cancelled'; by: 'customer' | 'business' }
  /** El cliente cambió el horario desde su enlace */
  | { kind: 'rescheduled'; previousStartsAt: Date };

export interface NotifyOptions {
  /** El bot ya le respondió al cliente en el chat: no repetir por WhatsApp */
  skipCustomerWhatsapp?: boolean;
}

/**
 * Traduce eventos de citas a avisos:
 * - Correo al cliente (si tiene) y a administradores y profesional.
 * - WhatsApp al cliente, si el negocio lo activó y el cliente lo aceptó.
 *
 * Se invoca sin `await`: los avisos salen en segundo plano y un fallo nunca
 * afecta a la reserva (queda registrado en email_logs / whatsapp_messages).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly whatsapp: WhatsappService,
    config: ConfigService,
  ) {
    this.appUrl = config.get('FRONTEND_URL', 'http://localhost:5173');
  }

  notifyAppointment(
    appointmentId: string,
    event: AppointmentEvent,
    options: NotifyOptions = {},
  ): void {
    this.dispatch(appointmentId, event, options).catch((error: Error) =>
      this.logger.error(
        `No se pudieron enviar los avisos de la cita ${appointmentId}: ${error.message}`,
      ),
    );
  }

  private async dispatch(
    appointmentId: string,
    event: AppointmentEvent,
    options: NotifyOptions,
  ) {
    const appt = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: {
        customer: true,
        service: { select: { name: true } },
        resource: {
          select: { name: true, user: { select: { email: true } } },
        },
        business: {
          include: {
            memberships: {
              where: { role: { in: MANAGER_ROLES } },
              orderBy: { createdAt: 'asc' },
              include: { user: { select: { email: true } } },
            },
          },
        },
      },
    });

    const { business, customer } = appt;
    // Administradores y el profesional de la cita (sin repetir)
    const ownerEmails = [
      ...new Set([
        ...business.memberships.map((m) => m.user.email),
        ...(appt.resource.user ? [appt.resource.user.email] : []),
      ]),
    ];
    const bookAgainUrl = `${this.appUrl}/b/${business.slug}`;
    const data: AppointmentEmailData = {
      businessName: business.name,
      businessPhone: business.phone,
      businessAddress:
        [business.address, business.city].filter(Boolean).join(', ') || null,
      timezone: business.timezone,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerEmail: customer.email,
      serviceName: appt.service.name,
      resourceName: appt.resource.name,
      price: appt.price,
      startsAt: appt.startsAt,
      manageUrl: `${this.appUrl}/cita/${appt.manageToken}`,
      agendaUrl: `${this.appUrl}/app/agenda?date=${toLocalDate(appt.startsAt, business.timezone)}`,
    };
    const isPending = appt.status === AppointmentStatus.PENDING;

    const emailCustomer = async (type: string, email: RenderedEmail) => {
      if (!customer.email) return;
      await this.mail.send({
        ...email,
        to: customer.email,
        // Si el cliente responde, le llega al negocio
        replyTo: ownerEmails[0],
        type,
        businessId: business.id,
      });
    };

    const emailOwners = (type: string, email: RenderedEmail) =>
      Promise.all(
        ownerEmails.map((to) =>
          this.mail.send({ ...email, to, type, businessId: business.id }),
        ),
      );

    // ─── WhatsApp al cliente ───
    const waKey: WhatsappTemplateKey =
      event.kind === 'created'
        ? isPending
          ? 'received'
          : 'confirmed'
        : event.kind === 'approved'
          ? 'confirmed'
          : event.kind;
    const sendWhatsapp =
      business.whatsappEnabled &&
      customer.whatsappOptIn &&
      !options.skipCustomerWhatsapp &&
      // Lo agendado por el bot ya se confirmó en la conversación
      !(event.kind === 'created' && appt.source === AppointmentSource.WHATSAPP);
    if (sendWhatsapp) {
      await this.whatsappCustomer(waKey, data, bookAgainUrl, business.id);
    }

    // ─── Correos ───
    switch (event.kind) {
      case 'created':
        await emailCustomer(
          isPending ? 'booking.received' : 'booking.confirmed',
          isPending
            ? bookingReceivedTemplate(data)
            : bookingConfirmedTemplate(data),
        );
        // Las citas creadas en el panel ya las conoce el negocio
        if (appt.source !== AppointmentSource.PANEL) {
          await emailOwners(
            'business.new-booking',
            businessNewBookingTemplate(data, isPending),
          );
        }
        break;

      case 'approved':
        await emailCustomer('booking.approved', bookingApprovedTemplate(data));
        break;

      case 'cancelled':
        await emailCustomer(
          'booking.cancelled',
          bookingCancelledTemplate(data, event.by === 'customer', bookAgainUrl),
        );
        if (event.by === 'customer') {
          await emailOwners(
            'business.cancelled',
            businessCancelledTemplate(data),
          );
        }
        break;

      case 'rescheduled':
        await emailCustomer(
          'booking.rescheduled',
          bookingRescheduledTemplate(data, event.previousStartsAt, isPending),
        );
        await emailOwners(
          'business.rescheduled',
          businessRescheduledTemplate(data, event.previousStartsAt, isPending),
        );
        break;
    }
  }

  /**
   * Dentro de la ventana de 24 h se envía texto libre (gratis); fuera de
   * ella, la plantilla aprobada por Meta con los mismos datos.
   */
  private async whatsappCustomer(
    key: WhatsappTemplateKey,
    d: AppointmentEmailData,
    bookAgainUrl: string,
    businessId: string,
  ) {
    const template = WHATSAPP_TEMPLATES[key];
    const firstName = d.customerName.split(' ')[0];
    const when = formatWhen(d.startsAt, d.timezone);
    const params =
      key === 'cancelled'
        ? [firstName, d.businessName, when, bookAgainUrl]
        : [
            firstName,
            d.businessName,
            when,
            d.serviceName,
            d.resourceName,
            d.manageUrl,
          ];
    const text = fillTemplate(template.body, params);

    const windowOpen = await this.whatsapp.isWindowOpen(d.customerPhone);
    await this.whatsapp.send(
      d.customerPhone,
      windowOpen
        ? { kind: 'text', text }
        : { kind: 'template', name: template.name, params, text },
      businessId,
    );
  }
}
