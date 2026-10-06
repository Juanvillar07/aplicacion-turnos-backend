/**
 * Plantilla base de los correos. HTML con tablas y estilos en línea porque es
 * lo único que todos los clientes de correo (Gmail, Outlook, iPhone) respetan.
 * Fondo claro a propósito: los correos oscuros se ven mal en muchos clientes.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface EmailContent {
  subject: string;
  /** Texto corto que algunos clientes muestran junto al asunto */
  preheader: string;
  heading: string;
  /** Párrafos de texto plano (se escapan) */
  paragraphs: string[];
  /** Filas "etiqueta: valor" en un recuadro (p. ej. detalles de la cita) */
  details?: [string, string][];
  button?: { label: string; url: string };
  /** Nota pequeña bajo el botón */
  note?: string;
  /** Quién envía, para el pie: "Barbería Don Juan" */
  senderName?: string;
}

const BRAND = '#6366f1';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderEmail(content: EmailContent): RenderedEmail {
  const e = escapeHtml;

  const paragraphs = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#3f3f46">${e(p)}</p>`,
    )
    .join('');

  const details = content.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;border:1px solid #e4e4e7;border-radius:8px;background:#fafafa">
        ${content.details
          .map(
            ([label, value]) => `<tr>
              <td style="padding:10px 16px;font-size:13px;color:#71717a;width:110px;vertical-align:top">${e(label)}</td>
              <td style="padding:10px 16px;font-size:14px;color:#18181b;font-weight:600">${e(value)}</td>
            </tr>`,
          )
          .join('')}
      </table>`
    : '';

  const button = content.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px"><tr>
        <td style="border-radius:8px;background:${BRAND}">
          <a href="${e(content.button.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${e(content.button.label)}</a>
        </td></tr></table>`
    : '';

  const note = content.note
    ? `<p style="margin:0 0 8px;font-size:13px;line-height:20px;color:#71717a">${e(content.note)}</p>`
    : '';

  const footer = content.senderName
    ? `Enviado por AgendaBarrio en nombre de ${e(content.senderName)}.`
    : 'Enviado por AgendaBarrio.';

  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(content.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0">${e(content.preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
        <tr><td style="padding:0 4px 20px;font-size:17px;font-weight:700;color:#18181b">
          <span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${BRAND};margin-right:8px"></span>Agenda<span style="color:${BRAND}">Barrio</span>
        </td></tr>
        <tr><td style="background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:32px 28px">
          <h1 style="margin:0 0 16px;font-size:21px;line-height:28px;color:#18181b">${e(content.heading)}</h1>
          ${paragraphs}${details}${button}${note}
        </td></tr>
        <tr><td style="padding:20px 4px;font-size:12px;line-height:18px;color:#a1a1aa;text-align:center">${footer}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    content.heading,
    '',
    ...content.paragraphs,
    '',
    ...(content.details ?? []).map(([l, v]) => `${l}: ${v}`),
    ...(content.button
      ? ['', `${content.button.label}: ${content.button.url}`]
      : []),
    ...(content.note ? ['', content.note] : []),
    '',
    footer,
  ].join('\n');

  return { subject: content.subject, html, text };
}
