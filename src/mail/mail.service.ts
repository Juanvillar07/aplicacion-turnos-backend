import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { createTransport, type Transporter } from 'nodemailer';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import type { RenderedEmail } from './templates/layout';

export interface MailMessage extends RenderedEmail {
  to: string;
  /** Identificador del tipo de correo, para el registro (p. ej. "booking.confirmed") */
  type: string;
  businessId?: string;
  replyTo?: string;
}

/** Carpeta donde se guardan los correos cuando no hay SMTP configurado */
const PREVIEW_DIR = join(process.cwd(), '.emails');

/**
 * Envía correos por SMTP (Amazon SES). Sin SMTP_HOST configurado, guarda cada
 * correo como HTML en backend/.emails para revisarlo en desarrollo.
 *
 * `send` nunca lanza errores: un correo fallido se registra en `email_logs`
 * pero no interrumpe la acción que lo originó (p. ej. una reserva).
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private readonly from: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.from = config.get(
      'MAIL_FROM',
      'AgendaBarrio <no-responder@localhost>',
    );
  }

  async onModuleInit() {
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      this.logger.warn(
        `SMTP_HOST no está configurado: los correos se guardarán en ${PREVIEW_DIR}`,
      );
      return;
    }

    const port = Number(this.config.get('SMTP_PORT', 587));
    this.transporter = createTransport({
      host,
      port,
      secure: port === 465, // 587 usa STARTTLS
      auth: {
        user: this.config.getOrThrow<string>('SMTP_USER'),
        pass: this.config.getOrThrow<string>('SMTP_PASS'),
      },
    });

    try {
      await this.transporter.verify();
      this.logger.log(`SMTP listo (${host}:${port}), remitente: ${this.from}`);
    } catch (error) {
      this.logger.error(
        `No se pudo conectar al SMTP (${host}:${port}): ${(error as Error).message}`,
      );
    }
  }

  async send(message: MailMessage): Promise<boolean> {
    let status: EmailStatus = EmailStatus.SENT;
    let errorMessage: string | undefined;

    try {
      if (this.transporter) {
        await this.transporter.sendMail({
          from: this.from,
          to: message.to,
          replyTo: message.replyTo,
          subject: message.subject,
          html: message.html,
          text: message.text,
        });
      } else {
        status = EmailStatus.PREVIEW;
        await this.writePreview(message);
      }
    } catch (error) {
      status = EmailStatus.FAILED;
      errorMessage = (error as Error).message;
      this.logger.error(
        `Falló el correo "${message.type}" a ${message.to}: ${errorMessage}`,
      );
    }

    await this.prisma.emailLog
      .create({
        data: {
          businessId: message.businessId,
          to: message.to,
          subject: message.subject,
          type: message.type,
          status,
          error: errorMessage,
        },
      })
      .catch((e: Error) =>
        this.logger.error(`No se pudo registrar el correo: ${e.message}`),
      );

    return status !== EmailStatus.FAILED;
  }

  private async writePreview(message: MailMessage) {
    await mkdir(PREVIEW_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    // Sufijo aleatorio: varios correos del mismo tipo pueden salir en el mismo milisegundo
    const suffix = randomBytes(3).toString('hex');
    const file = join(PREVIEW_DIR, `${stamp}_${message.type}_${suffix}.html`);
    const header = `<!-- Para: ${message.to} | Asunto: ${message.subject} -->\n`;
    await writeFile(file, header + message.html, 'utf8');
    this.logger.log(
      `📧 [vista previa] ${message.to} · "${message.subject}" → ${file}`,
    );
  }
}
