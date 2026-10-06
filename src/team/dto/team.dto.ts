import { MemberRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IsStrongPassword } from '../../common/validation/strong-password.decorator';

export class InviteMemberDto {
  @IsEmail({}, { message: 'El email no es válido' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @IsEnum(MemberRole, { message: 'Rol no válido' })
  role: MemberRole;

  /**
   * Solo profesionales: columna "sin cuenta" que se vinculará al aceptar.
   * Sin ella, al aceptar se crea una columna nueva con su nombre.
   */
  @IsOptional()
  @IsUUID('4', { message: 'Recurso no válido' })
  resourceId?: string;
}

export class UpdateMemberDto {
  @IsEnum(MemberRole, { message: 'Rol no válido' })
  role: MemberRole;
}

export class AcceptWithNewAccountDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name: string;

  @IsStrongPassword()
  password: string;
}
