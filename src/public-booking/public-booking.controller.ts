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
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AppointmentSource } from '@prisma/client';
import { AppointmentsService } from '../appointments/appointments.service';
import { BookAppointmentDto } from '../appointments/dto/book-appointment.dto';
import { RescheduleDto } from '../appointments/dto/reschedule.dto';
import { AvailabilityService } from '../availability/availability.service';
import { ParseDateStringPipe } from '../common/pipes/parse-date-string.pipe';
import { PublicBookingService } from './public-booking.service';

/** Rutas sin autenticación para los clientes finales. Limitadas por IP. */
@Controller('public')
@UseGuards(ThrottlerGuard)
export class PublicBookingController {
  constructor(
    private readonly publicBooking: PublicBookingService,
    private readonly availability: AvailabilityService,
    private readonly appointments: AppointmentsService,
  ) {}

  @Get('b/:slug')
  profile(@Param('slug') slug: string) {
    return this.publicBooking.getPublicProfile(slug);
  }

  @Get('b/:slug/availability')
  async slots(
    @Param('slug') slug: string,
    @Query('serviceId', ParseUUIDPipe) serviceId: string,
    @Query('date', ParseDateStringPipe) date: string,
    @Query('resourceId') resourceId?: string,
  ) {
    const business = await this.publicBooking.findBusinessBySlug(slug);
    const { slots } = await this.availability.getSlots({
      business,
      serviceId,
      resourceId: resourceId || null,
      date,
    });
    return slots;
  }

  @Get('b/:slug/availability/days')
  async days(
    @Param('slug') slug: string,
    @Query('serviceId', ParseUUIDPipe) serviceId: string,
    @Query('resourceId') resourceId?: string,
  ) {
    const business = await this.publicBooking.findBusinessBySlug(slug);
    return this.availability.daysWithAvailability({
      business,
      serviceId,
      resourceId: resourceId || null,
    });
  }

  @Post('b/:slug/appointments')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async book(@Param('slug') slug: string, @Body() dto: BookAppointmentDto) {
    const business = await this.publicBooking.findBusinessBySlug(slug);
    const appointment = await this.appointments.book({
      business,
      serviceId: dto.serviceId,
      resourceId: dto.resourceId,
      startsAt: new Date(dto.startsAt),
      customer: dto.customer,
      source: AppointmentSource.WEB,
    });
    // El cliente recibe el token para su enlace privado y la vista pública
    return this.appointments
      .findByToken(appointment.manageToken)
      .then((view) => ({
        ...view,
        manageToken: appointment.manageToken,
      }));
  }

  @Get('appointments/:token')
  findByToken(@Param('token') token: string) {
    return this.appointments.findByToken(token);
  }

  /** Días con turnos libres para mover la cita (mismo servicio y profesional) */
  @Get('appointments/:token/reschedule/days')
  rescheduleDays(@Param('token') token: string) {
    return this.appointments.rescheduleDays(token);
  }

  @Get('appointments/:token/reschedule/slots')
  rescheduleSlots(
    @Param('token') token: string,
    @Query('date', ParseDateStringPipe) date: string,
  ) {
    return this.appointments.rescheduleSlots(token, date);
  }

  @Post('appointments/:token/reschedule')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reschedule(@Param('token') token: string, @Body() dto: RescheduleDto) {
    return this.appointments.reschedule(token, new Date(dto.startsAt));
  }

  @Post('appointments/:token/cancel')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  cancel(@Param('token') token: string) {
    return this.appointments.cancelByToken(token);
  }
}
