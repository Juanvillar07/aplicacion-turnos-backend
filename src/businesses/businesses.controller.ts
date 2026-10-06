import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Membership } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BusinessScoped } from '../common/tenancy/business-scoped.decorator';
import { CurrentMembership } from '../common/tenancy/current-membership.decorator';
import { Roles } from '../common/tenancy/roles.decorator';
import { MANAGER_ROLES } from '../common/tenancy/roles';
import { slugify } from '../common/utils/slugify';
import { PublicUser } from '../users/entities/user.entity';
import { BusinessesService } from './businesses.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';

@Controller('businesses')
export class BusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: PublicUser, @Body() dto: CreateBusinessDto) {
    return this.businessesService.create(user.id, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findMine(@CurrentUser() user: PublicUser) {
    return this.businessesService.findMine(user.id);
  }

  @Get('slug-available')
  @UseGuards(JwtAuthGuard)
  async slugAvailable(@Query('slug') slug = '') {
    const normalized = slugify(slug);
    return {
      slug: normalized,
      available:
        normalized.length > 0 &&
        (await this.businessesService.isSlugAvailable(normalized)),
    };
  }

  @Get(':businessId')
  @BusinessScoped()
  async findOne(
    @Param('businessId') businessId: string,
    @CurrentMembership() membership: Membership,
  ) {
    const business = await this.businessesService.findById(businessId);
    return { ...business, role: membership.role };
  }

  @Patch(':businessId')
  @BusinessScoped()
  @Roles(...MANAGER_ROLES)
  async update(
    @Param('businessId') businessId: string,
    @Body() dto: UpdateBusinessDto,
    @CurrentMembership() membership: Membership,
  ) {
    const business = await this.businessesService.update(businessId, dto);
    return { ...business, role: membership.role };
  }
}
