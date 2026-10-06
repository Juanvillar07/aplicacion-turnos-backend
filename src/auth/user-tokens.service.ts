import { BadRequestException, Injectable } from '@nestjs/common';
import { UserTokenType } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const TTL_MS: Record<UserTokenType, number> = {
  VERIFY_EMAIL: 24 * 60 * 60_000,
  RESET_PASSWORD: 60 * 60_000,
};

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/**
 * Tokens de un solo uso para enlaces enviados por correo. En la base de datos
 * solo se guarda el hash: si alguien la lee, no puede usar los enlaces.
 */
@Injectable()
export class UserTokensService {
  constructor(private readonly prisma: PrismaService) {}

  /** Crea un token nuevo e invalida los anteriores del mismo tipo. */
  async issue(userId: string, type: UserTokenType): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.userToken.deleteMany({
        where: { userId, type, usedAt: null },
      }),
      this.prisma.userToken.create({
        data: {
          userId,
          type,
          tokenHash: hash(token),
          expiresAt: new Date(Date.now() + TTL_MS[type]),
        },
      }),
    ]);
    return token;
  }

  /** Marca el token como usado y devuelve el usuario dueño. */
  async consume(token: string, type: UserTokenType): Promise<string> {
    const record = await this.prisma.userToken.findUnique({
      where: { tokenHash: hash(token) },
    });
    if (
      !record ||
      record.type !== type ||
      record.usedAt ||
      record.expiresAt < new Date()
    ) {
      throw new BadRequestException(
        'El enlace no es válido o ya venció. Pide uno nuevo.',
      );
    }
    // updateMany con usedAt: null evita que dos peticiones usen el mismo token
    const { count } = await this.prisma.userToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) {
      throw new BadRequestException('Este enlace ya fue usado.');
    }
    return record.userId;
  }
}
