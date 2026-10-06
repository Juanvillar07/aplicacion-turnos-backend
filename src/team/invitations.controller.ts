import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PublicUser } from '../users/entities/user.entity';
import { AcceptWithNewAccountDto } from './dto/team.dto';
import { TeamService } from './team.service';

/** Enlace que recibe el invitado por correo: /invitations/:token */
@Controller('invitations')
@UseGuards(ThrottlerGuard)
export class InvitationsController {
  constructor(private readonly team: TeamService) {}

  @Get(':token')
  get(@Param('token') token: string) {
    return this.team.getByToken(token);
  }

  /** Acepta con la cuenta de la sesión actual (su email debe coincidir). */
  @Post(':token/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  accept(@Param('token') token: string, @CurrentUser() user: PublicUser) {
    return this.team.accept(token, user);
  }

  /** Crea la cuenta del invitado y acepta; devuelve la sesión. */
  @Post(':token/register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(
    @Param('token') token: string,
    @Body() dto: AcceptWithNewAccountDto,
  ) {
    return this.team.acceptWithNewAccount(token, dto.name, dto.password);
  }
}
