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
  Query,
} from '@nestjs/common';
import { BusinessScoped } from '../common/tenancy/business-scoped.decorator';
import { Roles } from '../common/tenancy/roles.decorator';
import { MANAGER_ROLES } from '../common/tenancy/roles';
import { CatalogService } from './catalog.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Controller('businesses/:businessId/services')
@BusinessScoped()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  findAll(
    @Param('businessId') businessId: string,
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.catalogService.findAll(businessId, includeInactive);
  }

  @Post()
  @Roles(...MANAGER_ROLES)
  create(
    @Param('businessId') businessId: string,
    @Body() dto: CreateServiceDto,
  ) {
    return this.catalogService.create(businessId, dto);
  }

  @Patch(':serviceId')
  @Roles(...MANAGER_ROLES)
  update(
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.catalogService.update(businessId, serviceId, dto);
  }

  @Delete(':serviceId')
  @Roles(...MANAGER_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
  ) {
    return this.catalogService.deactivate(businessId, serviceId);
  }
}
