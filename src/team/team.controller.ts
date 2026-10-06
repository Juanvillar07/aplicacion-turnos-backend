import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Membership } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BusinessScoped } from '../common/tenancy/business-scoped.decorator';
import { CurrentMembership } from '../common/tenancy/current-membership.decorator';
import { Roles } from '../common/tenancy/roles.decorator';
import { MANAGER_ROLES } from '../common/tenancy/roles';
import { PublicUser } from '../users/entities/user.entity';
import { InviteMemberDto, UpdateMemberDto } from './dto/team.dto';
import { TeamService } from './team.service';

/** Gestión del equipo del negocio (administradores). */
@Controller('businesses/:businessId/team')
@BusinessScoped()
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  @Roles(...MANAGER_ROLES)
  list(@Param('businessId') businessId: string) {
    return this.team.list(businessId);
  }

  @Post('invitations')
  @Roles(...MANAGER_ROLES)
  invite(
    @CurrentMembership() actor: Membership,
    @CurrentUser() user: PublicUser,
    @Body() dto: InviteMemberDto,
  ) {
    return this.team.invite(actor, user, dto);
  }

  @Post('invitations/:invitationId/resend')
  @Roles(...MANAGER_ROLES)
  @HttpCode(HttpStatus.OK)
  resend(
    @CurrentMembership() actor: Membership,
    @CurrentUser() user: PublicUser,
    @Param('invitationId') invitationId: string,
  ) {
    return this.team.resendInvitation(actor, user, invitationId);
  }

  @Delete('invitations/:invitationId')
  @Roles(...MANAGER_ROLES)
  revoke(
    @CurrentMembership() actor: Membership,
    @Param('invitationId') invitationId: string,
  ) {
    return this.team.revokeInvitation(actor, invitationId);
  }

  @Patch('members/:membershipId')
  @Roles(...MANAGER_ROLES)
  update(
    @CurrentMembership() actor: Membership,
    @Param('membershipId') membershipId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.team.updateMember(actor, membershipId, dto);
  }

  /** Cualquier miembro puede salir del negocio (DELETE de su propia membresía). */
  @Delete('members/:membershipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentMembership() actor: Membership,
    @Param('membershipId') membershipId: string,
  ) {
    return this.team.removeMember(actor, membershipId);
  }
}
