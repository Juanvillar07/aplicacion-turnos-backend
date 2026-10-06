-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('BASIC', 'PRO', 'PREMIUM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('SIMULATED', 'WOMPI');

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "code" "PlanCode" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price_monthly" INTEGER NOT NULL,
    "features" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "business_id" TEXT,
    "plan_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "is_complimentary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "reference" TEXT NOT NULL,
    "card_brand" TEXT,
    "card_last4" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_business_id_key" ON "subscriptions"("business_id");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_business_id_idx" ON "subscriptions"("user_id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_reference_key" ON "subscription_payments"("reference");

-- CreateIndex
CREATE INDEX "subscription_payments_subscription_id_created_at_idx" ON "subscription_payments"("subscription_id", "created_at");

-- CreateIndex
CREATE INDEX "subscription_payments_status_created_at_idx" ON "subscription_payments"("status", "created_at");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Datos iniciales ─────────────────────────────────────────
-- Planes (precios en COP; se pueden ajustar luego en la tabla)
INSERT INTO "plans" ("id", "code", "name", "description", "price_monthly", "features", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), 'BASIC', 'Básico', 'Para empezar a recibir reservas en línea.', 39900,
   '["Página de reservas propia", "Agenda y clientes", "Avisos por correo", "Hasta 2 profesionales"]', 1, now()),
  (gen_random_uuid(), 'PRO', 'Pro', 'Para negocios con equipo que quieren llenar la agenda.', 69900,
   '["Todo lo del plan Básico", "Hasta 6 profesionales", "Reservas y avisos por WhatsApp", "Reprogramación por el cliente"]', 2, now()),
  (gen_random_uuid(), 'PREMIUM', 'Premium', 'Para negocios grandes o con varias sedes.', 109900,
   '["Todo lo del plan Pro", "Profesionales ilimitados", "Soporte prioritario", "Pagos en línea (próximamente)"]', 3, now());

-- Los negocios creados antes de las suscripciones reciben un año del plan Pro
-- de cortesía, a nombre de su primer administrador
INSERT INTO "subscriptions" ("id", "user_id", "business_id", "plan_id", "status", "current_period_start", "current_period_end", "is_complimentary", "updated_at")
SELECT gen_random_uuid(), m."user_id", b."id", (SELECT "id" FROM "plans" WHERE "code" = 'PRO'), 'ACTIVE',
       now(), now() + interval '1 year', true, now()
FROM "businesses" b
JOIN LATERAL (
  SELECT "user_id" FROM "memberships"
  WHERE "business_id" = b."id" AND "role" = 'ADMIN'
  ORDER BY "created_at" ASC LIMIT 1
) m ON true;
