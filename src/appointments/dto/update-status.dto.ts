import { AppointmentStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateAppointmentStatusDto {
  @IsEnum(AppointmentStatus, { message: 'Estado no válido' })
  status: AppointmentStatus;
}
