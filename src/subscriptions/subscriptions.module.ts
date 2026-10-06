import { Module } from '@nestjs/common';
import { PaymentGateway, SimulatedGateway } from './payment-gateway';
import {
  BusinessSubscriptionController,
  PlansController,
  SubscriptionsController,
} from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  controllers: [
    PlansController,
    SubscriptionsController,
    BusinessSubscriptionController,
  ],
  providers: [
    SubscriptionsService,
    // Sin pasarela real todavía: cambiar aquí por la de Wompi
    { provide: PaymentGateway, useClass: SimulatedGateway },
  ],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
