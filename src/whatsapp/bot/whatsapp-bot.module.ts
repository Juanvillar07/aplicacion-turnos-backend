import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../../appointments/appointments.module';
import { AvailabilityModule } from '../../availability/availability.module';
import { CustomersModule } from '../../customers/customers.module';
import { WhatsappBotService } from './whatsapp-bot.service';
import { WhatsappController } from './whatsapp.controller';

/** Bot de reservas, webhook de Meta y simulador. */
@Module({
  imports: [AvailabilityModule, AppointmentsModule, CustomersModule],
  controllers: [WhatsappController],
  providers: [WhatsappBotService],
})
export class WhatsappBotModule {}
