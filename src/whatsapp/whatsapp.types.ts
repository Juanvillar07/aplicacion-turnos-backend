/** Mensaje que el bot o las notificaciones quieren enviar. */
export type OutgoingMessage =
  | { kind: 'text'; text: string }
  /** Hasta 3 botones de respuesta rápida (título ≤ 20 caracteres) */
  | { kind: 'buttons'; text: string; buttons: { id: string; title: string }[] }
  /** Lista desplegable de hasta 10 filas (título ≤ 24, descripción ≤ 72) */
  | {
      kind: 'list';
      text: string;
      button: string;
      rows: { id: string; title: string; description?: string }[];
    }
  /** Plantilla aprobada por Meta, para escribir fuera de la ventana de 24 h */
  | { kind: 'template'; name: string; params: string[]; text: string };

/** Mensaje recibido del cliente (ya normalizado desde el webhook). */
export interface InboundMessage {
  /**
   * Con quién es la conversación: el celular en E.164 (+573001234567) o, si
   * el cliente usa nombre de usuario y Meta oculta su número, su BSUID
   * (CO.1110671554703412).
   */
  from: string;
  /** Celular en E.164, solo si Meta lo envió */
  phone?: string;
  /** Texto escrito por el cliente */
  text?: string;
  /** id del botón o fila de lista que tocó */
  replyId?: string;
  /** Nombre del perfil de WhatsApp */
  profileName?: string;
  waMessageId?: string;
}
