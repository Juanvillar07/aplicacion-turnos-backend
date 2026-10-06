import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { InvitationsController } from './invitations.controller';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [TeamController, InvitationsController],
  providers: [TeamService],
})
export class TeamModule {}
