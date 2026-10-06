/**
 * Plantillas de WhatsApp (categoría UTILITY, español). Meta las debe aprobar
 * antes de usarlas: se crean con `npm run whatsapp:templates`.
 *
 * Dentro de la ventana de 24 h (el cliente escribió hace poco) se envía el
 * mismo contenido como texto libre, que no tiene costo.
 */
export interface WhatsappTemplateDefinition {
  name: string;
  body: string;
  /** Valores de ejemplo que Meta exige al revisar la plantilla */
  example: string[];
}

export const WHATSAPP_TEMPLATES = {
  confirmed: {
    name: 'agenda_cita_confirmada',
    body: 'Hola {{1}}, tu cita en {{2}} quedó confirmada.\n\nFecha: {{3}}\nServicio: {{4}} con {{5}}\n\nPuedes ver, reprogramar o cancelar tu cita aquí: {{6}}\n\nTe esperamos.',
    example: [
      'Mateo',
      'Barbería Don Juan',
      'Martes 6 de octubre · 10:00 a. m.',
      'Corte clásico',
      'Carlos',
      'https://agendabarrio.co/cita/abc123',
    ],
  },
  received: {
    name: 'agenda_cita_recibida',
    body: 'Hola {{1}}, recibimos tu solicitud de cita en {{2}}.\n\nFecha: {{3}}\nServicio: {{4}} con {{5}}\n\nEl negocio la confirmará pronto y te avisaremos por este medio. Puedes ver tu solicitud aquí: {{6}}\n\nGracias por reservar.',
    example: [
      'Mateo',
      'Barbería Don Juan',
      'Martes 6 de octubre · 10:00 a. m.',
      'Corte clásico',
      'Carlos',
      'https://agendabarrio.co/cita/abc123',
    ],
  },
  cancelled: {
    name: 'agenda_cita_cancelada',
    body: 'Hola {{1}}, tu cita en {{2}} del {{3}} fue cancelada.\n\nSi quieres agendar otro horario, puedes hacerlo aquí: {{4}}\n\nGracias por tu comprensión.',
    example: [
      'Mateo',
      'Barbería Don Juan',
      'martes 6 de octubre · 10:00 a. m.',
      'https://agendabarrio.co/b/barberia-don-juan',
    ],
  },
  rescheduled: {
    name: 'agenda_cita_reprogramada',
    body: 'Hola {{1}}, tu cita en {{2}} cambió de horario.\n\nNuevo horario: {{3}}\nServicio: {{4}} con {{5}}\n\nPuedes ver tu cita aquí: {{6}}\n\nTe esperamos.',
    example: [
      'Mateo',
      'Barbería Don Juan',
      'Miércoles 7 de octubre · 3:00 p. m.',
      'Corte clásico',
      'Carlos',
      'https://agendabarrio.co/cita/abc123',
    ],
  },
} satisfies Record<string, WhatsappTemplateDefinition>;

export type WhatsappTemplateKey = keyof typeof WHATSAPP_TEMPLATES;

/** Reemplaza {{1}}, {{2}}… por los parámetros (para el texto libre). */
export function fillTemplate(body: string, params: string[]): string {
  return body.replace(
    /\{\{(\d+)\}\}/g,
    (_, i: string) => params[Number(i) - 1] ?? '',
  );
}
