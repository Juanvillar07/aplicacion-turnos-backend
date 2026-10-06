import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class WorkingHoursSlotDto {
  /** 0 = domingo … 6 = sábado */
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  /** Minutos desde las 00:00 */
  @IsInt()
  @Min(0)
  @Max(1440)
  startMinute: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  endMinute: number;
}

export class SetWorkingHoursDto {
  @IsArray()
  @ArrayMaxSize(70)
  @ValidateNested({ each: true })
  @Type(() => WorkingHoursSlotDto)
  hours: WorkingHoursSlotDto[];
}
