/**
 * Da o quita el rol de superadministrador de la plataforma a un usuario ya
 * registrado (el dueño de AgendaBarrio, no el de un negocio).
 *
 *   npm run superadmin -- tu@correo.com           → lo vuelve superadministrador
 *   npm run superadmin -- tu@correo.com --revoke  → le quita el rol
 *   npm run superadmin -- --list                  → muestra los actuales
 *
 * No hay forma de hacerlo desde la web a propósito: así nadie puede
 * escalar privilegios desde el navegador.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    const admins = await prisma.user.findMany({
      where: { isSuperAdmin: true },
      select: { email: true, name: true },
      orderBy: { email: 'asc' },
    });
    if (admins.length === 0) console.log('No hay superadministradores.');
    for (const a of admins) console.log(`• ${a.email} (${a.name})`);
    return;
  }

  const email = args
    .find((a) => !a.startsWith('--'))
    ?.toLowerCase()
    .trim();
  if (!email) {
    console.error('Uso: npm run superadmin -- <email> [--revoke] | --list');
    process.exitCode = 1;
    return;
  }

  const revoke = args.includes('--revoke');
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(
      `No existe un usuario con el correo ${email}. Regístralo primero.`,
    );
    process.exitCode = 1;
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { isSuperAdmin: !revoke },
  });
  console.log(
    revoke
      ? `✓ ${email} ya no es superadministrador.`
      : `✓ ${email} ahora es superadministrador. Entra a /admin (si tenía la sesión abierta, recarga la página).`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
