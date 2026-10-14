/**
 * Archivo de calendario (.ics, RFC 5545) para "Agregar a mi calendario" en
 * Apple Calendar, Outlook y otros. Las horas van en UTC (sufijo Z).
 */
export interface CalendarEvent {
  uid: string;
  start: Date;
  end: Date;
  title: string;
  description: string;
  location?: string | null;
  url?: string;
}

/** 2026-10-06T15:00:00.000Z → 20261006T150000Z */
const icsDate = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** Escapa los caracteres especiales de un texto del formato */
const escape = (text: string) =>
  text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

/** Las líneas no deben pasar de 75 octetos: se parten con CRLF + espacio */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  for (const char of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (Buffer.byteLength(current + char, 'utf8') > limit) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildIcs(event: CalendarEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AgendaBarrio//Reservas//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}@agendabarrio`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(event.start)}`,
    `DTEND:${icsDate(event.end)}`,
    `SUMMARY:${escape(event.title)}`,
    `DESCRIPTION:${escape(event.description)}`,
    ...(event.location ? [`LOCATION:${escape(event.location)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    // Recordatorio 1 hora antes
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escape(event.title)}`,
    'TRIGGER:-PT1H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
