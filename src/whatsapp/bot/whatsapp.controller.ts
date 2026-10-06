import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Post,
  Query,
  type RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { normalizePhone } from '../../common/utils/phone';
import { WhatsappService } from '../whatsapp.service';
import { InboundMessage } from '../whatsapp.types';
import { SimulateMessageDto } from './simulate-message.dto';
import { WhatsappBotService } from './whatsapp-bot.service';

/** Forma (resumida) del cuerpo que Meta envía al webhook */
interface WebhookBody {
  object?: string;
  entry?: {
    changes?: {
      value?: {
        contacts?: {
          /** Celular; Meta lo omite si el cliente oculta su número */
          wa_id?: string;
          /** BSUID: id del cliente para este negocio, siempre presente */
          user_id?: string;
          profile?: { name?: string };
        }[];
        messages?: {
          from?: string;
          from_user_id?: string;
          id: string;
          type: string;
          text?: { body: string };
          interactive?: {
            button_reply?: { id: string; title: string };
            list_reply?: { id: string; title: string };
          };
          button?: { text: string; payload?: string };
        }[];
      };
    }[];
  }[];
}

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly bot: WhatsappBotService,
    private readonly config: ConfigService,
  ) {}

  /** Datos públicos para mostrar el enlace "Reservar por WhatsApp". */
  @Get('info')
  info() {
    const number = (
      this.config.get<string>('WHATSAPP_DISPLAY_NUMBER') ?? ''
    ).replace(/\D/g, '');
    return {
      configured: this.whatsapp.isConfigured,
      displayNumber: number || null,
      simulator: this.simulatorEnabled,
    };
  }

  // ─── Webhook de Meta ─────────────────────────────────────

  /** Meta verifica la URL una vez al configurarla en "WhatsApp → Configuración". */
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const expected = this.config.get<string>('WHATSAPP_VERIFY_TOKEN');
    if (mode === 'subscribe' && expected && token === expected)
      return challenge;
    throw new ForbiddenException('Token de verificación inválido');
  }

  /**
   * Mensajes entrantes. Se responde 200 de inmediato (Meta reintenta si
   * tardamos) y el bot procesa en segundo plano.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  receive(@Req() req: RawBodyRequest<Request>, @Body() body: WebhookBody) {
    this.assertSignature(req);
    const messages = this.parse(body);
    void this.process(messages);
    return { received: messages.length };
  }

  private async process(messages: InboundMessage[]) {
    // En orden: los mensajes de un mismo cliente deben procesarse en secuencia
    for (const msg of messages) {
      try {
        await this.whatsapp.recordInbound(msg);
        const { messages: replies, businessId } = await this.bot.handle(msg);
        for (const reply of replies) {
          await this.whatsapp.send(msg.from, reply, businessId);
        }
      } catch (error) {
        this.logger.error(
          `No se pudo procesar el mensaje de ${msg.from}: ${(error as Error).message}`,
        );
      }
    }
  }

  private parse(body: WebhookBody): InboundMessage[] {
    const result: InboundMessage[] = [];
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        for (const m of value?.messages ?? []) {
          const reply =
            m.interactive?.button_reply ?? m.interactive?.list_reply;
          const phone = m.from ? `+${m.from}` : undefined;
          const id = phone ?? m.from_user_id;
          if (!id) continue;
          const contact = value?.contacts?.find((c) =>
            m.from ? c.wa_id === m.from : c.user_id === m.from_user_id,
          );
          result.push({
            from: id,
            phone,
            waMessageId: m.id,
            profileName: contact?.profile?.name,
            ...(reply
              ? { replyId: reply.id, text: reply.title }
              : { text: m.text?.body ?? m.button?.text ?? '' }),
          });
        }
      }
    }
    return result;
  }

  /** Verifica que la petición venga de Meta (firma HMAC con el App Secret). */
  private assertSignature(req: RawBodyRequest<Request>) {
    const secret = this.config.get<string>('WHATSAPP_APP_SECRET');
    if (!secret) return; // En desarrollo puede omitirse
    const header = req.headers['x-hub-signature-256'];
    if (typeof header !== 'string' || !req.rawBody) {
      throw new ForbiddenException('Firma ausente');
    }
    const expected = `sha256=${createHmac('sha256', secret).update(req.rawBody).digest('hex')}`;
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Firma inválida');
    }
  }

  // ─── Simulador (solo desarrollo) ─────────────────────────

  private get simulatorEnabled() {
    return (
      this.config.get('NODE_ENV') !== 'production' ||
      this.config.get('WHATSAPP_SIMULATOR') === 'true'
    );
  }

  /** Conversa con el bot sin la API de Meta: devuelve sus respuestas. */
  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async simulate(@Body() dto: SimulateMessageDto) {
    if (!this.simulatorEnabled) throw new NotFoundException();
    const phone = normalizePhone(dto.phone);
    if (!phone) throw new BadRequestException('El celular no es válido');

    const inbound: InboundMessage = {
      from: phone,
      phone,
      text: dto.text,
      replyId: dto.replyId,
      profileName: dto.profileName,
    };
    await this.whatsapp.recordInbound(inbound);
    const { messages } = await this.bot.handle(inbound);
    return { messages };
  }
}
