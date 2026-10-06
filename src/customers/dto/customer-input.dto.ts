import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateBy,
} from 'class-validator';
import { normalizePhone } from '../../common/utils/phone';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Datos del cliente final al reservar (no tiene cuenta). */
export class CustomerInputDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(80)
  @Transform(trim)
  name: string;

  @IsEmail({}, { message: 'El email no es válido' })
  @MaxLength(120)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @IsString()
  @ValidateBy({
    name: 'isPhone',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && normalizePhone(value) !== null,
      defaultMessage: () => 'El celular no es válido',
    },
  })
  phone: string;

  /** Casilla "Quiero recibir avisos por WhatsApp" */
  @IsOptional()
  @IsBoolean()
  whatsappOptIn?: boolean;
}
