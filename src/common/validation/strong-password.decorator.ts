import { applyDecorators } from '@nestjs/common';
import { IsString, MaxLength, MinLength, ValidateBy } from 'class-validator';

/**
 * Política de contraseñas (la misma que muestra el frontend en
 * `utils/password.ts`): mínimo 8 caracteres, al menos una mayúscula y al
 * menos un carácter especial. Máximo 72 por el límite de bcrypt.
 */
export const PASSWORD_UPPERCASE = /\p{Lu}/u;
/** Cualquier cosa que no sea letra, número ni espacio: ! @ # $ % & * . - _ … */
export const PASSWORD_SPECIAL = /[^\p{L}\p{N}\s]/u;

/**
 * Regla con nombre propio: dos `@Matches` comparten el nombre "matches" y
 * class-validator solo conserva el mensaje de uno de ellos.
 */
const MatchesRule = (name: string, pattern: RegExp, message: string) =>
  ValidateBy({
    name,
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && pattern.test(value),
      defaultMessage: () => message,
    },
  });

export const IsStrongPassword = () =>
  applyDecorators(
    IsString(),
    MinLength(8, {
      message: 'La contraseña debe tener al menos 8 caracteres',
    }),
    MaxLength(72, {
      message: 'La contraseña no puede tener más de 72 caracteres',
    }),
    MatchesRule(
      'passwordUppercase',
      PASSWORD_UPPERCASE,
      'La contraseña debe tener al menos una letra mayúscula',
    ),
    MatchesRule(
      'passwordSpecial',
      PASSWORD_SPECIAL,
      'La contraseña debe tener al menos un carácter especial (por ejemplo ! @ # $ % . -)',
    ),
  );
