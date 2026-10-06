import { IsISO8601 } from 'class-validator';

export class RescheduleDto {
  @IsISO8601({ strict: true }, { message: 'Fecha y hora no válidas' })
  startsAt: string;
}
