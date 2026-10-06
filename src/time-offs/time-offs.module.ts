import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { TimeOffsController } from './time-offs.controller';
import { TimeOffsService } from './time-offs.service';

@Module({
  imports: [BusinessesModule],
  controllers: [TimeOffsController],
  providers: [TimeOffsService],
})
export class TimeOffsModule {}
