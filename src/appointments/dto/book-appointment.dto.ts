import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CustomerInputDto } from '../../customers/dto/customer-input.dto';

/** Reserva desde la página pública. `resourceId` vacío = "cualquiera disponible". */
export class BookAppointmentDto {
  @IsUUID('4', { message: 'Servicio no válido' })
  serviceId: string;

  @IsOptional()
  @IsUUID('4', { message: 'Profesional no válido' })
  resourceId?: string | null;

  @IsISO8601({ strict: true }, { message: 'Fecha y hora no válidas' })
  startsAt: string;

  @ValidateNested()
  @Type(() => CustomerInputDto)
  customer: CustomerInputDto;
}

/** Cita creada por el negocio desde el panel. */
export class CreatePanelAppointmentDto extends BookAppointmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}
