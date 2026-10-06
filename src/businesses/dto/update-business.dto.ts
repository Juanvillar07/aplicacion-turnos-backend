import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SLUG_PATTERN } from '../../common/utils/slugify';
import { CreateBusinessDto } from './create-business.dto';

export class UpdateBusinessDto extends PartialType(CreateBusinessDto) {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(SLUG_PATTERN, {
    message: 'El enlace solo puede tener minúsculas, números y guiones',
  })
  slug?: string;

  // ─── Ajustes de reserva ───

  @IsOptional()
  @IsBoolean()
  autoConfirm?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsappEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(5, { message: 'El intervalo mínimo entre turnos es 5 minutos' })
  @Max(120, { message: 'El intervalo máximo entre turnos es 2 horas' })
  slotStepMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2880, { message: 'El aviso mínimo no puede superar 48 horas' })
  minNoticeMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'Debe permitirse reservar al menos 1 día adelante' })
  @Max(180, { message: 'El horizonte máximo es de 180 días' })
  maxDaysAhead?: number;
}
