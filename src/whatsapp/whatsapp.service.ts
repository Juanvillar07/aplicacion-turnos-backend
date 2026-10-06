import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WhatsappDirection, WhatsappStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { InboundMessage, OutgoingMessage } from './whatsapp.types';

/** Carpeta donde se guardan los mensajes cuando no hay token configurado */
const PREVIEW_DIR = join(process.cwd(), '.whatsapp');
/** Margen de seguridad sobre la ventana de 24 h de Meta */
const WINDOW_MS = 23 * 60 * 60_000;

const truncate = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/**
 * Cliente de la WhatsApp Cloud API de Meta.
 *
 * Sin WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID, los mensajes se guardan como
 * texto en backend/.whatsapp (modo vista previa). `send` nunca lanza errores:
 * los fallos quedan en la tabla whatsapp_messages.
 */
/** BSUID de Meta: código de país + punto + id (CO.1110671554703412) */
export const isBsuid = (id: string) => /^[A-Z]{2}\./.test(id);

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly token?: string;
  private readonly phoneNumberId?: string;
  private readonly apiVersion: string;
  private readonly language: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.token = config.get<string>('WHATSAPP_TOKEN') || undefined;
    this.phoneNumberId =
      config.get<string>('WHATSAPP_PHONE_NUMBER_ID') || undefined;
    this.apiVersion = config.get('WHATSAPP_API_VERSION', 'v25.0');
    this.language = config.get('WHATSAPP_TEMPLATE_LANGUAGE', 'es');
  }

  onModuleInit() {
    if (this.isConfigured) {
      this.logger.log(`WhatsApp listo (número ${this.phoneNumberId})`);
    } else {
      this.logger.warn(
        `WhatsApp sin configurar: los mensajes se guardarán en ${PREVIEW_DIR}`,
      );
    }
  }

  get isConfigured(): boolean {
    return Boolean(this.token && this.phoneNumberId);
  }

  /** ¿El cliente escribió en las últimas ~24 h? (se puede enviar texto libre gratis) */
  async isWindowOpen(phone: string): Promise<boolean> {
    const session = await this.prisma.whatsappSession.findUnique({
      where: { phone },
      select: { lastInboundAt: true },
    });
    return Boolean(
      session?.lastInboundAt &&
      Date.now() - session.lastInboundAt.getTime() < WINDOW_MS,
    );
  }

  /** Registra un mensaje entrante y abre/renueva la ventana de 24 h. */
  async recordInbound(message: InboundMessage) {
    await Promise.all([
      this.prisma.whatsappSession.upsert({
        where: { phone: message.from },
        update: { lastInboundAt: new Date() },
        create: { phone: message.from, lastInboundAt: new Date() },
      }),
      this.prisma.whatsappMessage.create({
        data: {
          direction: WhatsappDirection.IN,
          phone: message.from,
          kind: message.replyId ? 'interactive' : 'text',
          content: message as unknown as Prisma.InputJsonValue,
          status: WhatsappStatus.RECEIVED,
          waMessageId: message.waMessageId,
        },
      }),
    ]);
  }

  async send(
    phone: string,
    message: OutgoingMessage,
    businessId?: string | null,
  ): Promise<boolean> {
    let status: WhatsappStatus = WhatsappStatus.SENT;
    let error: string | undefined;
    let waMessageId: string | undefined;

    try {
      if (this.isConfigured) {
        waMessageId = await this.post(this.payload(phone, message));
      } else {
        status = WhatsappStatus.PREVIEW;
        await this.writePreview(phone, message);
      }
    } catch (e) {
      status = WhatsappStatus.FAILED;
      error = (e as Error).message;
      this.logger.error(
        `Falló WhatsApp (${message.kind}) a ${phone}: ${error}`,
      );
    }

    await this.prisma.whatsappMessage
      .create({
        data: {
          direction: WhatsappDirection.OUT,
          phone,
          businessId: businessId ?? undefined,
          kind: message.kind,
          content: message,
          status,
          error,
          waMessageId,
        },
      })
      .catch((e: Error) =>
        this.logger.error(`No se pudo registrar el WhatsApp: ${e.message}`),
      );
    return status !== WhatsappStatus.FAILED;
  }

  /** Arma el cuerpo que espera la Cloud API para cada tipo de mensaje. */
  private payload(phone: string, message: OutgoingMessage) {
    const base = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      // Celular → "to"; BSUID (cliente con número oculto) → "recipient"
      ...(isBsuid(phone)
        ? { recipient: phone }
        : { to: phone.replace(/\D/g, '') }),
    };
    switch (message.kind) {
      case 'text':
        return {
          ...base,
          type: 'text',
          text: { body: message.text, preview_url: true },
        };
      case 'buttons':
        return {
          ...base,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: truncate(message.text, 1024) },
            action: {
              buttons: message.buttons.slice(0, 3).map((b) => ({
                type: 'reply',
                reply: { id: b.id, title: truncate(b.title, 20) },
              })),
            },
          },
        };
      case 'list':
        return {
          ...base,
          type: 'interactive',
          interactive: {
            type: 'list',
            body: { text: truncate(message.text, 1024) },
            action: {
              button: truncate(message.button, 20),
              sections: [
                {
                  title: 'Opciones',
                  rows: message.rows.slice(0, 10).map((r) => ({
                    id: r.id,
                    title: truncate(r.title, 24),
                    ...(r.description && {
                      description: truncate(r.description, 72),
                    }),
                  })),
                },
              ],
            },
          },
        };
      case 'template':
        return {
          ...base,
          type: 'template',
          template: {
            name: message.name,
            language: { code: this.language },
            components: [
              {
                type: 'body',
                parameters: message.params.map((text) => ({
                  type: 'text',
                  text,
                })),
              },
            ],
          },
        };
    }
  }

  private async post(body: unknown): Promise<string | undefined> {
    const res = await fetch(
      `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };
    if (!res.ok) {
      throw new Error(
        `${res.status} ${data.error?.code ?? ''} ${data.error?.message ?? 'Error de la API de WhatsApp'}`.trim(),
      );
    }
    return data.messages?.[0]?.id;
  }

  private async writePreview(phone: string, message: OutgoingMessage) {
    await mkdir(PREVIEW_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(
      PREVIEW_DIR,
      `${stamp}_${message.kind}_${randomBytes(3).toString('hex')}.txt`,
    );
    const lines = [`Para: ${phone}`, `Tipo: ${message.kind}`, ''];
    if (message.kind === 'template')
      lines.push(`Plantilla: ${message.name}`, '');
    lines.push(message.text);
    if (message.kind === 'buttons') {
      lines.push('', ...message.buttons.map((b) => `[ ${b.title} ]`));
    }
    if (message.kind === 'list') {
      lines.push(
        '',
        `(${message.button})`,
        ...message.rows.map(
          (r) => `• ${r.title}${r.description ? ` — ${r.description}` : ''}`,
        ),
      );
    }
    await writeFile(file, lines.join('\n'), 'utf8');
    this.logger.log(`💬 [vista previa] ${phone} · ${message.kind} → ${file}`);
  }
}
