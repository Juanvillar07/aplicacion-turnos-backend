import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Invitation,
  MemberRole,
  Membership,
  Prisma,
  ResourceType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { AuthService } from '../auth/auth.service';
import { MailService } from '../mail/mail.service';
import { teamInvitationTemplate } from '../mail/templates/account.templates';
import { PrismaService } from '../prisma/prisma.service';
import { PublicUser } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { InviteMemberDto, UpdateMemberDto } from './dto/team.dto';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60_000;

export const ROLE_LABELS: Record<MemberRole, string> = {
  ADMIN: 'administrador',
  STAFF: 'profesional',
};

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

function statusOf(inv: Invitation): InvitationStatus {
  if (inv.acceptedAt) return 'ACCEPTED';
  if (inv.revokedAt) return 'REVOKED';
  if (inv.expiresAt < new Date()) return 'EXPIRED';
  return 'PENDING';
}

/**
 * Equipo de un negocio: miembros, roles, invitaciones y vínculo de cada
 * profesional con su columna de la agenda (Resource.userId).
 *
 * Reglas:
 * - Dos roles: ADMIN (dueño o encargado; gestiona todo y no atiende) y
 *   STAFF (profesional; atiende y tiene su columna en la agenda).
 * - Siempre debe quedar al menos un administrador.
 * - Los profesionales entran solo por invitación. Al aceptar se vinculan a la
 *   columna indicada en la invitación (una existente "sin cuenta") o se les
 *   crea una nueva con su nombre.
 * - Cada profesional tiene exactamente una columna por negocio.
 */
@Injectable()
export class TeamService {
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly users: UsersService,
    private readonly auth: AuthService,
    config: ConfigService,
  ) {
    this.appUrl = config.get('FRONTEND_URL', 'http://localhost:5173');
  }

  // ─── Miembros ────────────────────────────────────────────

  async list(businessId: string) {
    const [memberships, resources, invitations] = await Promise.all([
      this.prisma.membership.findMany({
        where: { businessId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.resource.findMany({
        where: { businessId, userId: { not: null } },
        select: { id: true, name: true, userId: true },
      }),
      this.prisma.invitation.findMany({
        where: {
          businessId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: {
          resource: { select: { id: true, name: true } },
          invitedBy: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      members: memberships.map((m) => {
        const resource = resources.find((r) => r.userId === m.userId);
        return {
          id: m.id,
          role: m.role,
          joinedAt: m.createdAt,
          user: m.user,
          resource: resource ? { id: resource.id, name: resource.name } : null,
        };
      }),
      invitations: invitations.map(({ tokenHash: _hash, ...inv }) => {
        void _hash;
        return inv;
      }),
    };
  }

  /**
   * Cambia el rol. Profesional → administrador: su columna queda "sin cuenta"
   * (conserva horario y citas). Administrador → profesional: se le crea su
   * columna en la agenda.
   */
  async updateMember(
    actor: Membership,
    membershipId: string,
    dto: UpdateMemberDto,
  ) {
    const target = await this.findMember(actor.businessId, membershipId);
    if (dto.role === target.role) return this.list(actor.businessId);
    if (target.role === MemberRole.ADMIN) await this.assertNotLastAdmin(target);

    await this.prisma.$transaction(async (tx) => {
      await tx.membership.update({
        where: { id: target.id },
        data: { role: dto.role },
      });
      if (dto.role === MemberRole.ADMIN) {
        await tx.resource.updateMany({
          where: { businessId: target.businessId, userId: target.userId },
          data: { userId: null },
        });
      } else {
        await this.createOwnResource(tx, target.businessId, target.userId);
      }
    });
    return this.list(actor.businessId);
  }

  /** Quitar a alguien del equipo, o salir uno mismo. */
  async removeMember(actor: Membership, membershipId: string) {
    const target = await this.findMember(actor.businessId, membershipId);
    const isSelf = target.id === actor.id;
    if (!isSelf && actor.role !== MemberRole.ADMIN) {
      throw new ForbiddenException(
        'No tienes permisos para gestionar el equipo',
      );
    }
    if (target.role === MemberRole.ADMIN) await this.assertNotLastAdmin(target);

    await this.prisma.$transaction([
      this.prisma.resource.updateMany({
        where: { businessId: target.businessId, userId: target.userId },
        data: { userId: null },
      }),
      this.prisma.membership.delete({ where: { id: target.id } }),
    ]);
  }

  // ─── Invitaciones (desde el panel) ───────────────────────

  async invite(actor: Membership, inviter: PublicUser, dto: InviteMemberDto) {
    if (dto.resourceId && dto.role !== MemberRole.STAFF) {
      throw new BadRequestException(
        'Solo los profesionales tienen columna en la agenda',
      );
    }

    const alreadyMember = await this.prisma.membership.findFirst({
      where: { businessId: actor.businessId, user: { email: dto.email } },
    });
    if (alreadyMember) {
      throw new ConflictException('Esa persona ya es parte del equipo');
    }
    if (dto.resourceId) {
      await this.assertResourceAvailable(actor.businessId, dto.resourceId);
    }

    const token = randomBytes(32).toString('base64url');
    // Una sola invitación vigente por correo y por columna: la anterior se revoca
    const [, invitation] = await this.prisma.$transaction([
      this.prisma.invitation.updateMany({
        where: {
          businessId: actor.businessId,
          acceptedAt: null,
          revokedAt: null,
          OR: [
            { email: dto.email },
            ...(dto.resourceId ? [{ resourceId: dto.resourceId }] : []),
          ],
        },
        data: { revokedAt: new Date() },
      }),
      this.prisma.invitation.create({
        data: {
          businessId: actor.businessId,
          email: dto.email,
          role: dto.role,
          resourceId: dto.resourceId,
          invitedById: inviter.id,
          tokenHash: hash(token),
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        },
        include: { business: { select: { name: true } } },
      }),
    ]);

    await this.sendInvitation(
      invitation,
      invitation.business.name,
      inviter.name,
      token,
    );
    return this.list(actor.businessId);
  }

  async resendInvitation(
    actor: Membership,
    inviter: PublicUser,
    invitationId: string,
  ) {
    const invitation = await this.findPendingInvitation(
      actor.businessId,
      invitationId,
    );

    const token = randomBytes(32).toString('base64url');
    const updated = await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: {
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
      include: { business: { select: { name: true } } },
    });
    await this.sendInvitation(
      updated,
      updated.business.name,
      inviter.name,
      token,
    );
    return this.list(actor.businessId);
  }

  async revokeInvitation(actor: Membership, invitationId: string) {
    const invitation = await this.findPendingInvitation(
      actor.businessId,
      invitationId,
    );
    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() },
    });
    return this.list(actor.businessId);
  }

  // ─── Invitaciones (enlace del invitado) ──────────────────

  async getByToken(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hash(token) },
      include: {
        business: { select: { name: true, category: true } },
        invitedBy: { select: { name: true } },
      },
    });
    if (!invitation) throw new NotFoundException('Invitación no encontrada');

    const hasAccount = Boolean(await this.users.findByEmail(invitation.email));
    return {
      email: invitation.email,
      role: invitation.role,
      status: statusOf(invitation),
      expiresAt: invitation.expiresAt,
      business: invitation.business,
      invitedBy: invitation.invitedBy.name,
      hasAccount,
    };
  }

  /** Acepta con la cuenta con la que el usuario ya inició sesión. */
  async accept(token: string, user: PublicUser) {
    const invitation = await this.findUsableInvitation(token);
    if (invitation.email !== user.email.toLowerCase()) {
      throw new ForbiddenException(
        `Esta invitación es para ${invitation.email}. Inicia sesión con esa cuenta para aceptarla.`,
      );
    }
    await this.join(invitation, user.id);
    if (!user.emailVerifiedAt) await this.users.markEmailVerified(user.id);
    return { businessId: invitation.businessId };
  }

  /** Crea la cuenta del invitado (correo ya verificado por el enlace) y acepta. */
  async acceptWithNewAccount(token: string, name: string, password: string) {
    const invitation = await this.findUsableInvitation(token);
    if (await this.users.findByEmail(invitation.email)) {
      throw new ConflictException(
        'Ya existe una cuenta con este correo. Inicia sesión para aceptar la invitación.',
      );
    }

    const created = await this.users.create({
      email: invitation.email,
      name,
      password: await bcrypt.hash(password, 10),
    });
    const user = await this.users.markEmailVerified(created.id);
    await this.join(invitation, user.id);

    const session = await this.auth.buildAuthResponse(user);
    return { ...session, businessId: invitation.businessId };
  }

  // ─── Auxiliares ──────────────────────────────────────────

  private async join(invitation: Invitation, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const membership = await tx.membership.upsert({
        where: {
          userId_businessId: { userId, businessId: invitation.businessId },
        },
        update: {},
        create: {
          userId,
          businessId: invitation.businessId,
          role: invitation.role,
        },
      });
      // Un profesional queda con su columna en la agenda: la de la
      // invitación si sigue libre, la que ya tenía o una nueva con su nombre
      if (membership.role === MemberRole.STAFF) {
        const resource = invitation.resourceId
          ? await tx.resource.findFirst({
              where: {
                id: invitation.resourceId,
                businessId: invitation.businessId,
                userId: null,
              },
              select: { id: true },
            })
          : null;
        if (resource) {
          await this.linkResource(tx, membership, resource.id);
        } else {
          await this.createOwnResource(tx, invitation.businessId, userId);
        }
      }
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
    });
  }

  /** Vincula (o desvincula con null) a la persona con un recurso del negocio. */
  private async linkResource(
    tx: Prisma.TransactionClient,
    member: Membership,
    resourceId: string | null,
  ) {
    if (resourceId)
      await this.assertResourceAvailable(
        member.businessId,
        resourceId,
        member.userId,
        tx,
      );
    await tx.resource.updateMany({
      where: { businessId: member.businessId, userId: member.userId },
      data: { userId: null },
    });
    if (resourceId) {
      await tx.resource.update({
        where: { id: resourceId },
        data: { userId: member.userId },
      });
    }
  }

  private async assertResourceAvailable(
    businessId: string,
    resourceId: string,
    allowedUserId?: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const resource = await tx.resource.findFirst({
      where: { id: resourceId, businessId },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!resource) throw new NotFoundException('Recurso no encontrado');
    if (resource.user && resource.user.id !== allowedUserId) {
      throw new BadRequestException(
        `${resource.name} ya está vinculado a ${resource.user.name}`,
      );
    }
  }

  private async findMember(businessId: string, membershipId: string) {
    const member = await this.prisma.membership.findFirst({
      where: { id: membershipId, businessId },
    });
    if (!member) throw new NotFoundException('Miembro no encontrado');
    return member;
  }

  private async findPendingInvitation(
    businessId: string,
    invitationId: string,
  ) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, businessId },
    });
    if (!invitation || statusOf(invitation) !== 'PENDING') {
      throw new NotFoundException('La invitación ya no está pendiente');
    }
    return invitation;
  }

  private async findUsableInvitation(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hash(token) },
    });
    const status = invitation ? statusOf(invitation) : null;
    if (!invitation || status !== 'PENDING') {
      const reason =
        status === 'ACCEPTED'
          ? 'Esta invitación ya fue aceptada.'
          : status === 'EXPIRED'
            ? 'Esta invitación venció. Pide una nueva al negocio.'
            : 'Esta invitación no es válida.';
      throw new BadRequestException(reason);
    }
    return invitation;
  }

  /**
   * Crea la columna de la agenda de un profesional (si aún no tiene una), con
   * su nombre y todos los servicios activos. El administrador define después
   * el horario.
   */
  private async createOwnResource(
    tx: Prisma.TransactionClient,
    businessId: string,
    userId: string,
  ) {
    const existing = await tx.resource.findFirst({
      where: { businessId, userId },
      select: { id: true },
    });
    if (existing) return;

    const [user, services] = await Promise.all([
      tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { name: true },
      }),
      tx.service.findMany({
        where: { businessId, isActive: true },
        select: { id: true },
      }),
    ]);
    // Si vuelve a ser profesional, recupera su columna "sin cuenta" anterior
    const previous = await tx.resource.findFirst({
      where: {
        businessId,
        userId: null,
        type: ResourceType.PERSON,
        name: user.name,
      },
      select: { id: true },
    });
    if (previous) {
      await tx.resource.update({
        where: { id: previous.id },
        data: { userId, isActive: true },
      });
      return;
    }
    await tx.resource.create({
      data: {
        businessId,
        userId,
        name: user.name,
        type: ResourceType.PERSON,
        services: { create: services.map((sv) => ({ serviceId: sv.id })) },
      },
    });
  }

  private async assertNotLastAdmin(target: Membership) {
    const admins = await this.prisma.membership.count({
      where: { businessId: target.businessId, role: MemberRole.ADMIN },
    });
    if (admins <= 1) {
      throw new BadRequestException(
        'El negocio debe tener al menos un administrador. Nombra otro antes de hacer este cambio.',
      );
    }
  }

  private async sendInvitation(
    invitation: Invitation,
    businessName: string,
    inviterName: string,
    token: string,
  ) {
    await this.mail.send({
      ...teamInvitationTemplate({
        inviterName,
        businessName,
        roleLabel: ROLE_LABELS[invitation.role],
        url: `${this.appUrl}/invitations/${token}`,
      }),
      to: invitation.email,
      type: 'team.invitation',
      businessId: invitation.businessId,
    });
  }
}
