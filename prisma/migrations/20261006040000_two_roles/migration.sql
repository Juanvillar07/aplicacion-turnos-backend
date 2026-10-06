-- Solo dos roles por negocio: ADMIN (gestiona, no atiende) y STAFF (atiende).
-- Los propietarios pasan a ser administradores.
UPDATE "memberships" SET "role" = 'ADMIN' WHERE "role" = 'OWNER';
UPDATE "invitations" SET "role" = 'ADMIN' WHERE "role" = 'OWNER';

-- Un administrador no tiene columna en la agenda: se desvincula
-- (la columna se conserva con su horario y sus citas, como "sin cuenta")
UPDATE "resources" r SET "user_id" = NULL
FROM "memberships" m
WHERE m."business_id" = r."business_id" AND m."user_id" = r."user_id" AND m."role" = 'ADMIN';
UPDATE "invitations" SET "resource_id" = NULL WHERE "role" = 'ADMIN';

-- Postgres no permite quitar valores de un enum: se recrea
ALTER TYPE "MemberRole" RENAME TO "MemberRole_old";
CREATE TYPE "MemberRole" AS ENUM ('ADMIN', 'STAFF');
ALTER TABLE "memberships" ALTER COLUMN "role" TYPE "MemberRole" USING ("role"::text::"MemberRole");
ALTER TABLE "invitations" ALTER COLUMN "role" TYPE "MemberRole" USING ("role"::text::"MemberRole");
DROP TYPE "MemberRole_old";
