import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { AuthModule } from './auth/auth.module';
import { AvailabilityModule } from './availability/availability.module';
import { BusinessesModule } from './businesses/businesses.module';
import { CatalogModule } from './catalog/catalog.module';
import { CustomersModule } from './customers/customers.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { PublicBookingModule } from './public-booking/public-booking.module';
import { ResourcesModule } from './resources/resources.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { TeamModule } from './team/team.module';
import { TimeOffsModule } from './time-offs/time-offs.module';
import { UsersModule } from './users/users.module';
import { WhatsappBotModule } from './whatsapp/bot/whatsapp-bot.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Límite por IP; lo aplican los controladores con ThrottlerGuard
    // (rutas públicas y de autenticación). 120 peticiones por minuto por defecto.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      errorMessage:
        'Demasiadas solicitudes. Espera un minuto e inténtalo de nuevo.',
    }),
    PrismaModule,
    MailModule,
    WhatsappModule,
    UsersModule,
    AuthModule,
    BusinessesModule,
    CatalogModule,
    ResourcesModule,
    AvailabilityModule,
    CustomersModule,
    AppointmentsModule,
    TimeOffsModule,
    PublicBookingModule,
    TeamModule,
    WhatsappBotModule,
    AdminModule,
    SubscriptionsModule,
  ],
})
export class AppModule {}
