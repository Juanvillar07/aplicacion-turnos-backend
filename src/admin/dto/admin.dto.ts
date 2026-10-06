import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BusinessStatus } from '@prisma/client';

export class ListBusinessesQuery {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;

  @IsOptional()
  @IsEnum(BusinessStatus)
  status?: BusinessStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

export class SuspendBusinessDto {
  @IsString()
  @MinLength(5, { message: 'Escribe el motivo (mínimo 5 caracteres)' })
  @MaxLength(300)
  reason!: string;
}
