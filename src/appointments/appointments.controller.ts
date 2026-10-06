import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AppointmentSource, Membership } from '@prisma/client';
import { AvailabilityService } from '../availability/availability.service';
import { BusinessesService } from '../businesses/businesses.service';
import { ParseDateStringPipe } from '../common/pipes/parse-date-string.pipe';
import { BusinessScoped } from '../common/tenancy/business-scoped.decorator';
import { CurrentMembership } from '../common/tenancy/current-membership.decorator';
import { ownResourceIds } from '../common/tenancy/roles';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService } from './appointments.service';
import { CreatePanelAppointmentDto } from './dto/book-appointment.dto';
import { UpdateAppointmentStatusDto } from './dto/update-status.dto';

const OWN_ONLY = 'Solo puedes gestionar las citas de tu propia agenda';

/**
 * Agenda del panel. Los administradores ven todo; un profesional
 * solo las citas de los recursos vinculados a su cuenta.
 */
@Controller('businesses/:businessId')
@BusinessScoped()
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly availability: AvailabilityService,
    private readonly businesses: BusinessesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('appointments')
  async findByDay(
    @Param('businessId') businessId: string,
    @Query('date', ParseDateStringPipe) date: string,
    @CurrentMembership() membership: Membership,
  ) {
    const business = await this.businesses.findById(businessId);
    const scope = await ownResourceIds(this.prisma, membership);
    return this.appointments.findByDay(business, date, scope);
  }

  @Get('appointments/pending-count')
  async pendingCount(
    @Param('businessId') businessId: string,
    @CurrentMembership() membership: Membership,
  ) {
    const scope = await ownResourceIds(this.prisma, membership);
    return { count: await this.appointments.countPending(businessId, scope) };
  }

  @Post('appointments')
  async create(
    @Param('businessId') businessId: string,
    @Body() dto: CreatePanelAppointmentDto,
    @CurrentMembership() membership: Membership,
  ) {
    const scope = await ownResourceIds(this.prisma, membership);
    // Un profesional solo agenda en su propia columna
    const resourceId =
      scope && !dto.resourceId && scope.length === 1
        ? scope[0]
        : dto.resourceId;
    if (scope && (!resourceId || !scope.includes(resourceId))) {
      throw new ForbiddenException(OWN_ONLY);
    }

    const business = await this.businesses.findById(businessId);
    return this.appointments.book({
      business,
      serviceId: dto.serviceId,
      resourceId,
      startsAt: new Date(dto.startsAt),
      customer: dto.customer,
      notes: dto.notes,
      source: AppointmentSource.PANEL,
    });
  }

  @Patch('appointments/:appointmentId/status')
  async updateStatus(
    @Param('businessId') businessId: string,
    @Param('appointmentId') appointmentId: string,
    @Body() dto: UpdateAppointmentStatusDto,
    @CurrentMembership() membership: Membership,
  ) {
    const scope = await ownResourceIds(this.prisma, membership);
    return this.appointments.updateStatus(
      businessId,
      appointmentId,
      dto.status,
      scope,
    );
  }

  /** Turnos para citas manuales (no exige el aviso mínimo). */
  @Get('availability')
  async slots(
    @Param('businessId') businessId: string,
    @Query('serviceId') serviceId: string,
    @Query('date', ParseDateStringPipe) date: string,
    @CurrentMembership() membership: Membership,
    @Query('resourceId') resourceId?: string,
  ) {
    const scope = await ownResourceIds(this.prisma, membership);
    const target =
      scope && !resourceId && scope.length === 1 ? scope[0] : resourceId;
    if (scope && (!target || !scope.includes(target))) {
      throw new ForbiddenException(OWN_ONLY);
    }

    const business = await this.businesses.findById(businessId);
    const { slots } = await this.availability.getSlots({
      business,
      serviceId,
      resourceId: target || null,
      date,
      ignoreMinNotice: true,
    });
    return slots;
  }
}
