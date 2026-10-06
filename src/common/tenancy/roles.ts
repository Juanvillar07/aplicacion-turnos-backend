import { MemberRole, Membership } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Administradores: gestionan todo el negocio */
export const MANAGER_ROLES: MemberRole[] = [MemberRole.ADMIN];

export const isManager = (role: MemberRole) => MANAGER_ROLES.includes(role);

/**
 * Recursos (columnas de la agenda) a los que está limitado un miembro.
 * - Administrador: `null` = sin límite, ve todo.
 * - Profesional: solo los recursos vinculados a su cuenta (puede ser lista vacía).
 */
export async function ownResourceIds(
  prisma: PrismaService,
  membership: Membership,
): Promise<string[] | null> {
  if (isManager(membership.role)) return null;
  const resources = await prisma.resource.findMany({
    where: { businessId: membership.businessId, userId: membership.userId },
    select: { id: true },
  });
  return resources.map((r) => r.id);
}
