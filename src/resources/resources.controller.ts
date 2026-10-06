import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { BusinessScoped } from '../common/tenancy/business-scoped.decorator';
import { Roles } from '../common/tenancy/roles.decorator';
import { MANAGER_ROLES } from '../common/tenancy/roles';
import { CreateResourceDto } from './dto/create-resource.dto';
import { SetResourceServicesDto } from './dto/set-resource-services.dto';
import { SetWorkingHoursDto } from './dto/set-working-hours.dto';
import { UpdateResourceDto } from './dto/update-resource.dto';
import { ResourcesService } from './resources.service';

@Controller('businesses/:businessId/resources')
@BusinessScoped()
export class ResourcesController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Get()
  findAll(
    @Param('businessId') businessId: string,
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.resourcesService.findAll(businessId, includeInactive);
  }

  @Post()
  @Roles(...MANAGER_ROLES)
  create(
    @Param('businessId') businessId: string,
    @Body() dto: CreateResourceDto,
  ) {
    return this.resourcesService.create(businessId, dto);
  }

  @Patch(':resourceId')
  @Roles(...MANAGER_ROLES)
  update(
    @Param('businessId') businessId: string,
    @Param('resourceId') resourceId: string,
    @Body() dto: UpdateResourceDto,
  ) {
    return this.resourcesService.update(businessId, resourceId, dto);
  }

  @Delete(':resourceId')
  @Roles(...MANAGER_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(
    @Param('businessId') businessId: string,
    @Param('resourceId') resourceId: string,
  ) {
    return this.resourcesService.deactivate(businessId, resourceId);
  }

  @Put(':resourceId/services')
  @Roles(...MANAGER_ROLES)
  setServices(
    @Param('businessId') businessId: string,
    @Param('resourceId') resourceId: string,
    @Body() dto: SetResourceServicesDto,
  ) {
    return this.resourcesService.setServices(
      businessId,
      resourceId,
      dto.serviceIds,
    );
  }

  @Put(':resourceId/working-hours')
  @Roles(...MANAGER_ROLES)
  setWorkingHours(
    @Param('businessId') businessId: string,
    @Param('resourceId') resourceId: string,
    @Body() dto: SetWorkingHoursDto,
  ) {
    return this.resourcesService.setWorkingHours(
      businessId,
      resourceId,
      dto.hours,
    );
  }
}
