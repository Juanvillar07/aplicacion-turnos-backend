import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { PublicUser } from '../users/entities/user.entity';

/**
 * Solo el superadministrador de la plataforma. Debe usarse después de
 * `JwtAuthGuard`, que recarga el usuario desde la base de datos en cada
 * petición: quitarle el rol surte efecto de inmediato.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<Request>().user as
      PublicUser | undefined;
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException('Solo para el superadministrador');
    }
    return true;
  }
}
