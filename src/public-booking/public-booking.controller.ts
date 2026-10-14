import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  DefaultValuePipe,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AppointmentSource } from '@prisma/client';
import { AppointmentsService } from '../appointments/appointments.service';
import { buildIcs } from '../appointments/calendar';
import { BookAppointmentDto } from '../appointments/dto/book-appointment.dto';
import { RescheduleDto } from '../appointments/dto/reschedule.dto';
import { AvailabilityService } from '../availability/availability.service';
import { ParseDateStringPipe } from '../common/pipes/parse-date-string.pipe';
import { ReviewsService } from '../reviews/reviews.service';
import { PublicBookingService } from './public-booking.service';

/** Rutas sin autenticación para los clientes finales. Limitadas por IP. */
@Controller('public')
@UseGuards(ThrottlerGuard)
export class PublicBookingController {
  constructor(
    private readonly publicBooking: PublicBookingService,
    private readonly availability: AvailabilityService,
    private readonly appointments: AppointmentsService,
    private readonly reviews: ReviewsService,
  ) {}

  @Get('b/:slug')
  profile(@Param('slug') slug: string) {
    return this.publicBooking.getPublicProfile(slug);
  }

  /** Reseñas publicadas, de 5 en 5 ("Ver más") */
  @Get('b/:slug/reviews')
  async reviewsPage(
    @Param('slug') slug: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ) {
    const business = await this.publicBooking.findBusinessBySlug(slug);
    return this.reviews.publicList(business.id, Math.max(1, page));
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

  /** "Agregar a mi calendario" (Apple Calendar, Outlook…) */
  @Get('appointments/:token/calendar.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="cita.ics"')
  async calendar(@Param('token') token: string) {
    const appt = await this.appointments.findByToken(token);
    const appUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const location = [appt.business.address, appt.business.city]
      .filter(Boolean)
      .join(', ');
    return buildIcs({
      uid: appt.id,
      start: appt.startsAt,
      end: appt.endsAt,
      title: `${appt.service.name} · ${appt.business.name}`,
      description: [
        `${appt.service.name} con ${appt.resource.name}`,
        appt.business.phone ? `Teléfono: ${appt.business.phone}` : null,
        `Ver, reprogramar o cancelar: ${appUrl}/cita/${token}`,
      ]
        .filter(Boolean)
        .join('\n'),
      location: location || null,
      url: `${appUrl}/cita/${token}`,
    });
  }

  @Post('appointments/:token/cancel')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  cancel(@Param('token') token: string) {
    return this.appointments.cancelByToken(token);
  }
}
