import { renderEmail } from './layout';

const firstName = (name: string) => name.split(' ')[0];

export function verifyEmailCodeTemplate(name: string, code: string) {
  return renderEmail({
    subject: `${code} es tu código de AgendaBarrio`,
    preheader: 'Escríbelo para confirmar tu correo.',
    heading: `Hola, ${firstName(name)}`,
    paragraphs: [
      'Escribe este código en AgendaBarrio para confirmar tu correo y continuar:',
    ],
    code,
    note: 'El código vence en 10 minutos. Si no fuiste tú, ignora este mensaje: nadie podrá usar tu correo sin él.',
  });
}

export function resetPasswordTemplate(name: string, url: string) {
  return renderEmail({
    subject: 'Restablece tu contraseña de AgendaBarrio',
    preheader: 'Crea una contraseña nueva.',
    heading: `Hola, ${firstName(name)}`,
    paragraphs: [
      'Recibimos una solicitud para restablecer la contraseña de tu cuenta. Haz clic en el botón para crear una nueva.',
    ],
    button: { label: 'Crear contraseña nueva', url },
    note: 'El enlace vence en 1 hora y solo se puede usar una vez. Si no lo pediste tú, ignora este mensaje: tu contraseña no cambiará.',
  });
}

export function teamInvitationTemplate(params: {
  inviterName: string;
  businessName: string;
  roleLabel: string;
  url: string;
}) {
  const { inviterName, businessName, roleLabel, url } = params;
  return renderEmail({
    subject: `${inviterName} te invitó a ${businessName} en AgendaBarrio`,
    preheader: `Únete como ${roleLabel}.`,
    heading: `Te invitaron a ${businessName}`,
    paragraphs: [
      `${inviterName} te invitó a unirte al equipo de ${businessName} en AgendaBarrio como ${roleLabel}.`,
      'Con tu cuenta podrás ver tu agenda y gestionar tus citas desde el celular o el computador.',
    ],
    button: { label: 'Aceptar invitación', url },
    note: 'La invitación vence en 7 días. Si no esperabas este correo, puedes ignorarlo.',
    senderName: businessName,
  });
}

export function businessSuspendedTemplate(params: {
  businessName: string;
  reason: string;
}) {
  const { businessName, reason } = params;
  return renderEmail({
    subject: `${businessName} fue suspendido en AgendaBarrio`,
    preheader: 'Tu página de reservas está pausada.',
    heading: 'Tu negocio fue suspendido',
    paragraphs: [
      `Suspendimos ${businessName} en AgendaBarrio. Mientras tanto tu página de reservas y el asistente de WhatsApp no reciben citas nuevas, y el panel queda en solo lectura.`,
      'Tus clientes todavía pueden cancelar las citas que ya tenían. Si crees que es un error, responde a este correo.',
    ],
    details: [['Motivo', reason]],
  });
}

export function businessReactivatedTemplate(params: {
  businessName: string;
  url: string;
}) {
  const { businessName, url } = params;
  return renderEmail({
    subject: `${businessName} está activo de nuevo en AgendaBarrio`,
    preheader: 'Ya puedes recibir reservas otra vez.',
    heading: '¡Tu negocio está activo de nuevo!',
    paragraphs: [
      `Reactivamos ${businessName}. Tu página de reservas y el asistente de WhatsApp ya reciben citas otra vez, y puedes usar el panel con normalidad.`,
    ],
    button: { label: 'Ir a mi panel', url },
  });
}
