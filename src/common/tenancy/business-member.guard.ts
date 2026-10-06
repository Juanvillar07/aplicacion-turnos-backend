import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BusinessStatus, MemberRole, Membership } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicUser } from '../../users/entities/user.entity';
import { ROLES_KEY } from './roles.decorator';

export interface TenantRequest extends Request {
  user: PublicUser;
  membership: Membership;
}

/**
 * Aísla a los inquilinos: verifica que el usuario autenticado sea miembro
 * del negocio indicado en `:businessId` (y que tenga el rol requerido).
 * Debe usarse después de `JwtAuthGuard`.
 */
@Injectable()
export class BusinessMemberGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const businessId = request.params.businessId;
    const userId = request.user?.id;

    if (typeof businessId !== 'string' || !userId) {
      throw new ForbiddenException();
    }

    const found = await this.prisma.membership.findUnique({
      where: { userId_businessId: { userId, businessId } },
      include: { business: { select: { status: true } } },
    });
    if (!found) {
      throw new ForbiddenException('No perteneces a este negocio');
    }
    const { business, ...membership } = found;

    // Negocio suspendido por la plataforma: el panel queda en solo lectura
    if (
      business.status === BusinessStatus.SUSPENDED &&
      request.method !== 'GET'
    ) {
      throw new ForbiddenException(
        'Este negocio está suspendido: el panel está en solo lectura',
      );
    }

    const requiredRoles = this.reflector.getAllAndOverride<
      MemberRole[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (requiredRoles?.length && !requiredRoles.includes(membership.role)) {
      throw new ForbiddenException('No tienes permisos para esta acción');
    }

    request.membership = membership;
    return true;
  }
}
