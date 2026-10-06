import { User } from '@prisma/client';

/** Representación pública del usuario: nunca expone el hash de la contraseña. */
export type PublicUser = Omit<User, 'password'>;

export function toPublicUser(user: User): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, ...rest } = user;
  return rest;
}
