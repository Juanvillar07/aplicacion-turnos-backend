import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class SubmitReviewDto {
  @IsInt({ message: 'Elige de 1 a 5 estrellas' })
  @Min(1, { message: 'Elige de 1 a 5 estrellas' })
  @Max(5, { message: 'Elige de 1 a 5 estrellas' })
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'El comentario admite hasta 500 caracteres' })
  comment?: string;
}

export class UpdateReviewDto {
  /** Respuesta pública del negocio; `null` o "" la borra */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500, { message: 'La respuesta admite hasta 500 caracteres' })
  reply?: string | null;

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;
}

export class ListReviewsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
