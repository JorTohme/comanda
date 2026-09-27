DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "TurnoCaja"
    WHERE "estado" = 'abierto'
    GROUP BY "orgId", "sucursalId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate open shifts: reconcile before money migration';
  END IF;
END $$;

CREATE TYPE "MetodoCobro" AS ENUM ('efectivo', 'mercadopago');

DROP INDEX "Pedido_clientRequestId_key";
DROP INDEX "Pago_pedidoId_key";

ALTER TABLE "Pedido"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "requestFingerprint" TEXT;
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_version_nonnegative" CHECK ("version" >= 0);

ALTER TABLE "Pago"
  ADD COLUMN "externalReference" TEXT,
  ADD COLUMN "merchantId" TEXT,
  ADD COLUMN "moneda" TEXT NOT NULL DEFAULT 'ARS',
  ADD COLUMN "leaseUntil" TIMESTAMP(3),
  ADD COLUMN "incidente" TEXT,
  ALTER COLUMN "mpPreferenceId" DROP NOT NULL,
  ALTER COLUMN "mpInitPoint" DROP NOT NULL;

UPDATE "Pago" SET "externalReference" = "pedidoId";
ALTER TABLE "Pago" ALTER COLUMN "externalReference" SET NOT NULL;

ALTER TABLE "TurnoCaja"
  ADD COLUMN "semantica" TEXT NOT NULL DEFAULT 'efectivo',
  ADD COLUMN "totalDigital" INTEGER,
  ADD COLUMN "totalVentas" INTEGER;
UPDATE "TurnoCaja" SET "semantica" = 'legacy_mixta';

CREATE TABLE "Cobro" (
  "id" TEXT NOT NULL,
  "pedidoId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "sucursalId" TEXT NOT NULL,
  "monto" INTEGER NOT NULL,
  "metodo" "MetodoCobro" NOT NULL,
  "cobradoEn" TIMESTAMP(3),
  "mpPaymentId" TEXT,
  "usuarioId" TEXT,
  "turnoCajaId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Cobro_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Cobro_positive" CHECK ("monto" > 0)
);

CREATE UNIQUE INDEX "Cobro_pedidoId_key" ON "Cobro"("pedidoId");
CREATE UNIQUE INDEX "Cobro_mpPaymentId_key" ON "Cobro"("mpPaymentId");
CREATE INDEX "Cobro_orgId_sucursalId_cobradoEn_idx" ON "Cobro"("orgId", "sucursalId", "cobradoEn");
CREATE UNIQUE INDEX "Cobro_pedidoId_orgId_sucursalId_key" ON "Cobro"("pedidoId", "orgId", "sucursalId");
CREATE UNIQUE INDEX "Pedido_orgId_sucursalId_clientRequestId_key" ON "Pedido"("orgId", "sucursalId", "clientRequestId");
CREATE UNIQUE INDEX "Pedido_id_orgId_sucursalId_key" ON "Pedido"("id", "orgId", "sucursalId");
CREATE UNIQUE INDEX "Pago_externalReference_key" ON "Pago"("externalReference");
CREATE INDEX "Pago_orgId_sucursalId_pedidoId_idx" ON "Pago"("orgId", "sucursalId", "pedidoId");
CREATE UNIQUE INDEX "TurnoCaja_id_orgId_sucursalId_key" ON "TurnoCaja"("id", "orgId", "sucursalId");
CREATE UNIQUE INDEX "Pago_one_active_attempt" ON "Pago"("orgId", "sucursalId", "pedidoId")
  WHERE "estado" IN ('creando', 'pendiente');
CREATE UNIQUE INDEX "TurnoCaja_one_open" ON "TurnoCaja"("orgId", "sucursalId")
  WHERE "estado" = 'abierto';

ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_pedidoId_orgId_sucursalId_fkey"
  FOREIGN KEY ("pedidoId", "orgId", "sucursalId") REFERENCES "Pedido"("id", "orgId", "sucursalId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_sucursalId_fkey"
  FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_turnoCajaId_orgId_sucursalId_fkey"
  FOREIGN KEY ("turnoCajaId", "orgId", "sucursalId") REFERENCES "TurnoCaja"("id", "orgId", "sucursalId") ON DELETE RESTRICT ON UPDATE CASCADE;
