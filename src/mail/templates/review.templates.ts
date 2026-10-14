import { renderEmail } from './layout';

const firstName = (name: string) => name.split(' ')[0];

/** Al cliente, después de una cita completada */
export function reviewRequestTemplate(d: {
  customerName: string;
  businessName: string;
  serviceName: string;
  url: string;
}) {
  return renderEmail({
    subject: `¿Cómo te fue en ${d.businessName}?`,
    preheader: 'Califica tu visita en menos de un minuto.',
    heading: `Hola, ${firstName(d.customerName)}`,
    paragraphs: [
      `Gracias por visitar ${d.businessName}. ¿Cómo te fue con ${d.serviceName}?`,
      'Tu opinión ayuda al negocio a mejorar y a otros clientes a elegir.',
    ],
    button: { label: 'Calificar mi visita', url: d.url },
    note: 'El enlace es solo para ti y vence en 30 días.',
    senderName: d.businessName,
  });
}

/** A los administradores, cuando llega una reseña */
export function newReviewTemplate(d: {
  businessName: string;
  customerName: string;
  rating: number;
  comment: string | null;
  url: string;
}) {
  const stars = '★'.repeat(d.rating) + '☆'.repeat(5 - d.rating);
  return renderEmail({
    subject: `Nueva reseña de ${d.rating} estrella${d.rating === 1 ? '' : 's'} en ${d.businessName}`,
    preheader: d.comment ?? `${d.customerName} calificó su visita.`,
    heading: 'Tienes una reseña nueva',
    paragraphs: [`${d.customerName} calificó su visita a ${d.businessName}.`],
    details: [
      ['Calificación', stars],
      ...(d.comment ? ([['Comentario', d.comment]] as [string, string][]) : []),
    ],
    button: { label: 'Ver y responder', url: d.url },
  });
}
