import { BusinessCategory } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateBusinessDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre del negocio es obligatorio' })
  @MaxLength(80)
  @Transform(trim)
  name: string;

  @IsEnum(BusinessCategory, { message: 'Categoría no válida' })
  category: BusinessCategory;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9 ]{7,15}$/, { message: 'El teléfono no es válido' })
  @Transform(trim)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  city?: string;
}
