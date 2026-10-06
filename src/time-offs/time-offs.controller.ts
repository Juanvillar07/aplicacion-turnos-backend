import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { BusinessesService } from '../businesses/businesses.service';
import { ParseDateStringPipe } from '../common/pipes/parse-date-string.pipe';
import { BusinessScoped } from '../common/tenancy/business-scoped.decorator';
import { CurrentMembership } from '../common/tenancy/current-membership.decorator';
import { ownResourceIds } from '../common/tenancy/roles';
import { PrismaService } from '../prisma/prisma.service';
import { Membership } from '@prisma/client';
import { Roles } from '../common/tenancy/roles.decorator';
import { MANAGER_ROLES } from '../common/tenancy/roles';
import { CreateTimeOffDto } from './dto/create-time-off.dto';
import { TimeOffsService } from './time-offs.service';

@Controller('businesses/:businessId/time-offs')
@BusinessScoped()
export class TimeOffsController {
  constructor(
    private readonly timeOffs: TimeOffsService,
    private readonly businesses: BusinessesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async findByDay(
    @Param('businessId') businessId: string,
    @Query('date', ParseDateStringPipe) date: string,
    @CurrentMembership() membership: Membership,
  ) {
    const business = await this.businesses.findById(businessId);
    const scope = await ownResourceIds(this.prisma, membership);
    return this.timeOffs.findByDay(business, date, scope);
  }

  @Post()
  @Roles(...MANAGER_ROLES)
  create(
    @Param('businessId') businessId: string,
    @Body() dto: CreateTimeOffDto,
  ) {
    return this.timeOffs.create(businessId, dto);
  }

  @Delete(':timeOffId')
  @Roles(...MANAGER_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('businessId') businessId: string,
    @Param('timeOffId') timeOffId: string,
  ) {
    return this.timeOffs.remove(businessId, timeOffId);
  }
}
