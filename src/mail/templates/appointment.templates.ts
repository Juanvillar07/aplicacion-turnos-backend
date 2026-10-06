import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { renderEmail } from './layout';

/** Datos de una cita que necesitan las plantillas */
export interface AppointmentEmailData {
  businessName: string;
  businessPhone: string | null;
  businessAddress: string | null;
  timezone: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  serviceName: string;
  resourceName: string;
  price: number;
  startsAt: Date;
  /** Enlace privado del cliente para ver, cancelar o reprogramar */
  manageUrl: string;
  /** Enlace a la agenda del negocio en el panel */
  agendaUrl: string;
}

const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const firstName = (name: string) => name.split(' ')[0];

/** "Martes 6 de octubre · 10:00 a. m." en la zona del negocio */
export function formatWhen(date: Date, timezone: string): string {
  const local = new TZDate(date.getTime(), timezone);
  return capitalize(
    format(local, "EEEE d 'de' MMMM · h:mm aaa", { locale: es }),
  );
}

function customerDetails(d: AppointmentEmailData): [string, string][] {
  return [
    ['Servicio', d.serviceName],
    ['Cuándo', formatWhen(d.startsAt, d.timezone)],
    ['Con', d.resourceName],
    ['Valor', cop.format(d.price)],
    ...(d.businessAddress
      ? ([['Dónde', d.businessAddress]] as [string, string][])
      : []),
  ];
}

function businessDetails(d: AppointmentEmailData): [string, string][] {
  return [
    ['Cliente', d.customerName],
    ['Celular', d.customerPhone],
    ['Servicio', d.serviceName],
    ['Cuándo', formatWhen(d.startsAt, d.timezone)],
    ['Con', d.resourceName],
  ];
}

const contactNote = (d: AppointmentEmailData) =>
  d.businessPhone
    ? `¿Dudas? Comunícate con ${d.businessName} al ${d.businessPhone}.`
    : undefined;

// ─── Correos al cliente ─────────────────────────────────────

export function bookingConfirmedTemplate(d: AppointmentEmailData) {
  return renderEmail({
    subject: `Cita confirmada en ${d.businessName}`,
    preheader: formatWhen(d.startsAt, d.timezone),
    heading: `¡Listo, ${firstName(d.customerName)}! Tu cita está confirmada`,
    paragraphs: [`Te esperamos en ${d.businessName}.`],
    details: customerDetails(d),
    button: { label: 'Ver, reprogramar o cancelar', url: d.manageUrl },
    note: contactNote(d),
    senderName: d.businessName,
  });
}

export function bookingReceivedTemplate(d: AppointmentEmailData) {
  return renderEmail({
    subject: `Recibimos tu reserva en ${d.businessName}`,
    preheader: 'El negocio confirmará tu cita pronto.',
    heading: `Hola, ${firstName(d.customerName)}. Recibimos tu reserva`,
    paragraphs: [
      `${d.businessName} revisará tu solicitud y te avisaremos por este medio cuando la confirme.`,
    ],
    details: customerDetails(d),
    button: { label: 'Ver mi reserva', url: d.manageUrl },
    note: contactNote(d),
    senderName: d.businessName,
  });
}

export function bookingApprovedTemplate(d: AppointmentEmailData) {
  return renderEmail({
    subject: `${d.businessName} confirmó tu cita`,
    preheader: formatWhen(d.startsAt, d.timezone),
    heading: `¡Buenas noticias, ${firstName(d.customerName)}!`,
    paragraphs: [`${d.businessName} confirmó tu cita. Te esperamos.`],
    details: customerDetails(d),
    button: { label: 'Ver, reprogramar o cancelar', url: d.manageUrl },
    note: contactNote(d),
    senderName: d.businessName,
  });
}

export function bookingCancelledTemplate(
  d: AppointmentEmailData,
  byCustomer: boolean,
  bookAgainUrl: string,
) {
  return renderEmail({
    subject: `Cita cancelada en ${d.businessName}`,
    preheader: formatWhen(d.startsAt, d.timezone),
    heading: byCustomer
      ? 'Tu cita fue cancelada'
      : `${d.businessName} canceló tu cita`,
    paragraphs: [
      byCustomer
        ? 'Confirmamos la cancelación de tu cita. El horario quedó libre.'
        : `Lo sentimos, ${firstName(d.customerName)}. ${d.businessName} tuvo que cancelar tu cita. Puedes reservar otro horario cuando quieras.`,
    ],
    details: customerDetails(d),
    button: { label: 'Reservar otra cita', url: bookAgainUrl },
    note: contactNote(d),
    senderName: d.businessName,
  });
}

export function bookingRescheduledTemplate(
  d: AppointmentEmailData,
  previousStartsAt: Date,
  pending: boolean,
) {
  return renderEmail({
    subject: `Tu cita en ${d.businessName} cambió de horario`,
    preheader: formatWhen(d.startsAt, d.timezone),
    heading: 'Reprogramamos tu cita',
    paragraphs: [
      `Antes: ${formatWhen(previousStartsAt, d.timezone)}.`,
      pending
        ? `${d.businessName} debe confirmar el nuevo horario; te avisaremos cuando lo haga.`
        : 'Este es tu nuevo horario:',
    ],
    details: customerDetails(d),
    button: { label: 'Ver mi cita', url: d.manageUrl },
    note: contactNote(d),
    senderName: d.businessName,
  });
}

// ─── Correos al negocio ─────────────────────────────────────

export function businessNewBookingTemplate(
  d: AppointmentEmailData,
  pending: boolean,
) {
  return renderEmail({
    subject: pending
      ? `Nueva reserva por confirmar: ${d.customerName}`
      : `Nueva reserva: ${d.customerName}`,
    preheader: `${d.serviceName} · ${formatWhen(d.startsAt, d.timezone)}`,
    heading: pending
      ? 'Tienes una reserva por confirmar'
      : 'Tienes una nueva reserva',
    paragraphs: [
      pending
        ? 'Un cliente reservó desde tu página. Confírmala o recházala en la agenda.'
        : 'Un cliente reservó desde tu página y la cita quedó confirmada.',
    ],
    details: businessDetails(d),
    button: { label: 'Abrir la agenda', url: d.agendaUrl },
  });
}

export function businessCancelledTemplate(d: AppointmentEmailData) {
  return renderEmail({
    subject: `Cancelación: ${d.customerName}`,
    preheader: `${d.serviceName} · ${formatWhen(d.startsAt, d.timezone)}`,
    heading: 'Un cliente canceló su cita',
    paragraphs: ['El horario quedó libre para nuevas reservas.'],
    details: businessDetails(d),
    button: { label: 'Abrir la agenda', url: d.agendaUrl },
  });
}

export function businessRescheduledTemplate(
  d: AppointmentEmailData,
  previousStartsAt: Date,
  pending: boolean,
) {
  return renderEmail({
    subject: `Reprogramación: ${d.customerName}`,
    preheader: `Nuevo horario: ${formatWhen(d.startsAt, d.timezone)}`,
    heading: 'Un cliente reprogramó su cita',
    paragraphs: [
      `Horario anterior: ${formatWhen(previousStartsAt, d.timezone)}.`,
      pending
        ? 'El nuevo horario quedó pendiente: confírmalo en la agenda.'
        : 'El nuevo horario quedó confirmado.',
    ],
    details: businessDetails(d),
    button: { label: 'Abrir la agenda', url: d.agendaUrl },
  });
}
