import { SetMetadata } from '@nestjs/common';
import { MemberRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Restringe un endpoint de negocio a ciertos roles (por defecto: cualquier miembro). */
export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES_KEY, roles);
