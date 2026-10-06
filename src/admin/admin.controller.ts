import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PublicUser } from '../users/entities/user.entity';
import { AdminService } from './admin.service';
import { ListBusinessesQuery, SuspendBusinessDto } from './dto/admin.dto';
import { SuperAdminGuard } from './super-admin.guard';

/** Panel del dueño de la plataforma: todos los negocios y métricas globales. */
@Controller('admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('metrics')
  metrics() {
    return this.admin.metrics();
  }

  @Get('businesses')
  listBusinesses(@Query() query: ListBusinessesQuery) {
    return this.admin.listBusinesses(query);
  }

  @Get('businesses/:id')
  getBusiness(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getBusiness(id);
  }

  @Post('businesses/:id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendBusinessDto,
    @CurrentUser() user: PublicUser,
  ) {
    return this.admin.suspend(id, user.id, dto.reason.trim());
  }

  @Post('businesses/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: PublicUser,
  ) {
    return this.admin.reactivate(id, user.id);
  }
}
