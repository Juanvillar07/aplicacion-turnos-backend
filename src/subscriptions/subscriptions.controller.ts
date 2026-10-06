import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BusinessScoped } from '../common/tenancy/business-scoped.decorator';
import { Roles } from '../common/tenancy/roles.decorator';
import { MANAGER_ROLES } from '../common/tenancy/roles';
import { PublicUser } from '../users/entities/user.entity';
import {
  CreateSubscriptionDto,
  PaySubscriptionDto,
} from './dto/subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

/** Planes del SaaS: públicos, para la página "Crear tu negocio". */
@Controller('plans')
export class PlansController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  list() {
    return this.subscriptions.listPlans();
  }
}

/** Contratar la suscripción del próximo negocio (antes de crearlo). */
@Controller('subscriptions')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  /** `null` = aún no ha elegido plan */
  @Get('current')
  async current(@CurrentUser() user: PublicUser) {
    return (await this.subscriptions.current(user.id)) ?? null;
  }

  @Post()
  create(@CurrentUser() user: PublicUser, @Body() dto: CreateSubscriptionDto) {
    return this.subscriptions.create(user.id, dto.planCode);
  }

  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  pay(
    @CurrentUser() user: PublicUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PaySubscriptionDto,
  ) {
    return this.subscriptions.pay(user.id, id, dto);
  }
}

/** Suscripción de un negocio: solo administradores. */
@Controller('businesses/:businessId/subscription')
@BusinessScoped()
export class BusinessSubscriptionController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @Roles(...MANAGER_ROLES)
  async get(@Param('businessId') businessId: string) {
    return (await this.subscriptions.forBusiness(businessId)) ?? null;
  }
}
