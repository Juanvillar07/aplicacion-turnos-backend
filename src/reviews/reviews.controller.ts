import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { BusinessScoped } from '../common/tenancy/business-scoped.decorator';
import { Roles } from '../common/tenancy/roles.decorator';
import { MANAGER_ROLES } from '../common/tenancy/roles';
import {
  ListReviewsQuery,
  SubmitReviewDto,
  UpdateReviewDto,
} from './dto/review.dto';
import { ReviewsService } from './reviews.service';

/** Enlace del cliente para calificar su visita (sin sesión). */
@Controller('public/reviews')
@UseGuards(ThrottlerGuard)
export class PublicReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get(':token')
  get(@Param('token') token: string) {
    return this.reviews.getByToken(token);
  }

  @Post(':token')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  submit(@Param('token') token: string, @Body() dto: SubmitReviewDto) {
    return this.reviews.submit(token, dto);
  }
}

/** Reseñas del negocio en el panel: responder u ocultar (administradores). */
@Controller('businesses/:businessId/reviews')
@BusinessScoped()
@Roles(...MANAGER_ROLES)
export class BusinessReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(
    @Param('businessId') businessId: string,
    @Query() query: ListReviewsQuery,
  ) {
    return this.reviews.panelList(businessId, query);
  }

  @Patch(':reviewId')
  update(
    @Param('businessId') businessId: string,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.reviews.update(businessId, reviewId, dto);
  }
}
