import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsStrongPassword } from '../../common/validation/strong-password.decorator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'El email no es válido' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;
}

export class VerifyEmailCodeDto {
  @Matches(/^\d{6}$/, { message: 'El código tiene 6 dígitos' })
  code: string;
}

export class ChangeEmailDto {
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
  @IsStrongPassword()
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Escribe tu contraseña actual' })
  currentPassword: string;

  @IsStrongPassword()
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
