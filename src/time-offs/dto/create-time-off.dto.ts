import { Transform } from 'class-transformer';
import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateTimeOffDto {
  @IsUUID('4', { message: 'Recurso no válido' })
  resourceId: string;

  @IsISO8601({ strict: true }, { message: 'Fecha de inicio no válida' })
  startsAt: string;

  @IsISO8601({ strict: true }, { message: 'Fecha de fin no válida' })
  endsAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  reason?: string;
}
