import { Module } from '@nestjs/common';
import {
  BusinessReviewsController,
  PublicReviewsController,
} from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  controllers: [PublicReviewsController, BusinessReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
