import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { BusinessScoped } from '../common/tenancy/business-scoped.decorator';
import { CustomersService } from './customers.service';
import { UpdateCustomerNotesDto } from './dto/update-customer-notes.dto';

@Controller('businesses/:businessId/customers')
@BusinessScoped()
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  /** Listado paginado; búsqueda por nombre, email o celular. */
  @Get()
  list(
    @Param('businessId') businessId: string,
    @Query('search') search?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
  ) {
    return this.customersService.list(businessId, search, Math.max(page, 1));
  }

  @Get(':customerId')
  findOne(
    @Param('businessId') businessId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.customersService.findOne(businessId, customerId);
  }

  @Patch(':customerId')
  updateNotes(
    @Param('businessId') businessId: string,
    @Param('customerId') customerId: string,
    @Body() dto: UpdateCustomerNotesDto,
  ) {
    return this.customersService.updateNotes(
      businessId,
      customerId,
      dto.notes ?? null,
    );
  }
}
