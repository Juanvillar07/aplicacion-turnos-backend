import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { CustomersModule } from '../customers/customers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [
    AvailabilityModule,
    CustomersModule,
    BusinessesModule,
    NotificationsModule,
    ReviewsModule,
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
