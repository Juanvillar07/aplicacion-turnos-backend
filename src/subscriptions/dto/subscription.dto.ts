import { PlanCode } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const CARD_BRANDS = ['VISA', 'MASTERCARD', 'AMEX', 'OTHER'] as const;

export class CreateSubscriptionDto {
  @IsEnum(PlanCode, { message: 'Plan no válido' })
  planCode: PlanCode;
}

/**
 * Datos del pago. A propósito NO incluye el número completo de la tarjeta ni
 * el CVC: el formulario solo envía la marca y los últimos 4 dígitos.
 */
export class PaySubscriptionDto {
  @IsIn(CARD_BRANDS, { message: 'Marca de tarjeta no válida' })
  cardBrand: (typeof CARD_BRANDS)[number];

  @Matches(/^\d{4}$/, { message: 'Últimos 4 dígitos no válidos' })
  cardLast4: string;

  @IsString()
  @IsNotEmpty({ message: 'Escribe el nombre del titular' })
  @MaxLength(80)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  holderName: string;
}
