import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { MailService } from '../mail/mail.service';
import { verifyEmailCodeTemplate } from '../mail/templates/account.templates';
import { PrismaService } from '../prisma/prisma.service';
import { PublicUser } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';

/** Vigencia del código */
const CODE_TTL_MS = 10 * 60_000;
/** Tiempo mínimo entre envíos */
const RESEND_COOLDOWN_MS = 60_000;
/** Intentos fallidos antes de exigir un código nuevo */
const MAX_ATTEMPTS = 5;

/**
 * Verificación del correo con un código de 6 dígitos. Solo se guarda el
 * HMAC del código (con el id del usuario y un secreto del servidor), así que
 * quien lea la base de datos no puede usarlo.
 */
@Injectable()
export class EmailVerificationService {
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly users: UsersService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('JWT_SECRET');
  }

  /**
   * Genera y envía un código nuevo (invalida el anterior). Respeta un minuto
   * entre envíos salvo con `force` (al registrarse o al cambiar el correo).
   */
  async send(
    user: Pick<PublicUser, 'id' | 'name' | 'email'>,
    { force = false }: { force?: boolean } = {},
  ) {
    const now = Date.now();
    if (!force) {
      const existing = await this.prisma.emailVerificationCode.findUnique({
        where: { userId: user.id },
        select: { lastSentAt: true },
      });
      const wait = existing
        ? existing.lastSentAt.getTime() + RESEND_COOLDOWN_MS - now
        : 0;
      if (wait > 0) {
        throw new HttpException(
          `Espera ${Math.ceil(wait / 1000)} segundos para pedir otro código.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const data = {
      codeHash: this.hash(user.id, code),
      email: user.email,
      expiresAt: new Date(now + CODE_TTL_MS),
      attempts: 0,
      lastSentAt: new Date(now),
    };
    await this.prisma.emailVerificationCode.upsert({
      where: { userId: user.id },
      update: data,
      create: { ...data, userId: user.id },
    });

    await this.mail.send({
      ...verifyEmailCodeTemplate(user.name, code),
      to: user.email,
      type: 'account.verify-email',
    });
    return { resendAvailableAt: new Date(now + RESEND_COOLDOWN_MS) };
  }

  /**
   * ¿Hay un código vigente para el correo actual? (no envía nada). El
   * frontend lo usa para no pedir otro código si ya hay uno en camino.
   */
  async status(user: Pick<PublicUser, 'id' | 'email'>) {
    const record = await this.prisma.emailVerificationCode.findUnique({
      where: { userId: user.id },
    });
    const usable =
      !!record &&
      record.email === user.email &&
      record.expiresAt.getTime() > Date.now() &&
      record.attempts < MAX_ATTEMPTS;
    return {
      hasActiveCode: usable,
      resendAvailableAt: record
        ? new Date(record.lastSentAt.getTime() + RESEND_COOLDOWN_MS)
        : new Date(),
    };
  }

  /** Comprueba el código; si es correcto, el correo queda verificado. */
  async verify(userId: string, code: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new BadRequestException('Usuario no encontrado');
    if (user.emailVerifiedAt) {
      throw new BadRequestException('Tu correo ya está verificado');
    }

    const record = await this.prisma.emailVerificationCode.findUnique({
      where: { userId },
    });
    if (!record || record.email !== user.email) {
      throw new BadRequestException('Pide un código nuevo para continuar.');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('El código venció. Pide uno nuevo.');
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException(
        'Demasiados intentos. Pide un código nuevo.',
      );
    }

    const expected = Buffer.from(record.codeHash, 'hex');
    const received = Buffer.from(this.hash(userId, code), 'hex');
    if (!timingSafeEqual(expected, received)) {
      const { attempts } = await this.prisma.emailVerificationCode.update({
        where: { userId },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      const left = MAX_ATTEMPTS - attempts;
      throw new BadRequestException(
        left > 0
          ? `Código incorrecto. Te queda${left === 1 ? '' : 'n'} ${left} intento${left === 1 ? '' : 's'}.`
          : 'Código incorrecto. Pide un código nuevo.',
      );
    }

    await this.prisma.emailVerificationCode.delete({ where: { userId } });
    return this.users.markEmailVerified(userId);
  }

  private hash(userId: string, code: string) {
    return createHmac('sha256', this.secret)
      .update(`${userId}:${code}`)
      .digest('hex');
  }
}
