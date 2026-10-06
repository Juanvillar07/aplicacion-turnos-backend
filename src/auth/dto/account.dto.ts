import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const PASSWORD_MIN = {
  message: 'La contraseña debe tener al menos 8 caracteres',
};

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'El email no es válido' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;
}

export class TokenDto {
  @IsString()
  @IsNotEmpty({ message: 'Falta el código del enlace' })
  @MaxLength(200)
  token: string;
}

export class ResetPasswordDto extends TokenDto {
  @IsString()
  @MinLength(8, PASSWORD_MIN)
  @MaxLength(72) // límite de bcrypt
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Escribe tu contraseña actual' })
  currentPassword: string;

  @IsString()
  @MinLength(8, PASSWORD_MIN)
  @MaxLength(72) // límite de bcrypt
  newPassword: string;
}

export class UpdateProfileDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name: string;
}
