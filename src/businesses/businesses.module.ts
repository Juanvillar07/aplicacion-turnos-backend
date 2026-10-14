import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { BusinessMediaController } from './business-media.controller';
import { BusinessMediaService } from './business-media.service';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';

@Module({
  imports: [SubscriptionsModule],
  controllers: [BusinessesController, BusinessMediaController],
  providers: [BusinessesService, BusinessMediaService],
  exports: [BusinessesService],
})
export class BusinessesModule {}
