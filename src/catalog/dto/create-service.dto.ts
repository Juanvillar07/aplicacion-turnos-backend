import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateServiceDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre del servicio es obligatorio' })
  @MaxLength(80)
  @Transform(trim)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  description?: string;

  @IsInt({ message: 'La duración debe ser un número entero de minutos' })
  @Min(5, { message: 'La duración mínima es 5 minutos' })
  @Max(720, { message: 'La duración máxima es 12 horas' })
  durationMinutes: number;

  @IsInt({ message: 'El precio debe ser un valor entero en pesos' })
  @Min(0, { message: 'El precio no puede ser negativo' })
  @Max(100_000_000)
  price: number;
}
