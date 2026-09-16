-- Turn the placeholder tenant columns into enforced row isolation.
CREATE TYPE "RolUsuario" AS ENUM ('admin', 'caja', 'mozo', 'cocina');

CREATE TABLE "Organizacion" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organizacion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Sucursal" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Sucursal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL DEFAULT 'admin',
    "organizacionId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- Existing development data belonged to the original single tenant. Preserve it
-- under a deterministic legacy organization and branch before adding NOT NULL.
INSERT INTO "Organizacion" ("id", "nombre", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000001', 'Organización inicial', CURRENT_TIMESTAMP);
INSERT INTO "Sucursal" ("id", "nombre", "organizacionId", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000002', 'Sucursal inicial', '00000000-0000-0000-0000-000000000001', CURRENT_TIMESTAMP);

UPDATE "Categoria" SET "orgId" = '00000000-0000-0000-0000-000000000001', "sucursalId" = '00000000-0000-0000-0000-000000000002' WHERE "orgId" IS NULL OR "sucursalId" IS NULL;
UPDATE "Plato" SET "orgId" = '00000000-0000-0000-0000-000000000001', "sucursalId" = '00000000-0000-0000-0000-000000000002' WHERE "orgId" IS NULL OR "sucursalId" IS NULL;
UPDATE "Mesa" SET "orgId" = '00000000-0000-0000-0000-000000000001', "sucursalId" = '00000000-0000-0000-0000-000000000002' WHERE "orgId" IS NULL OR "sucursalId" IS NULL;
UPDATE "Pedido" SET "orgId" = '00000000-0000-0000-0000-000000000001', "sucursalId" = '00000000-0000-0000-0000-000000000002' WHERE "orgId" IS NULL OR "sucursalId" IS NULL;

ALTER TABLE "Categoria" ALTER COLUMN "orgId" SET NOT NULL, ALTER COLUMN "sucursalId" SET NOT NULL;
ALTER TABLE "Plato" ALTER COLUMN "orgId" SET NOT NULL, ALTER COLUMN "sucursalId" SET NOT NULL;
ALTER TABLE "Mesa" ALTER COLUMN "orgId" SET NOT NULL, ALTER COLUMN "sucursalId" SET NOT NULL;
ALTER TABLE "Pedido" ALTER COLUMN "orgId" SET NOT NULL, ALTER COLUMN "sucursalId" SET NOT NULL;

CREATE UNIQUE INDEX "Sucursal_organizacionId_nombre_key" ON "Sucursal"("organizacionId", "nombre");
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");
CREATE INDEX "Usuario_organizacionId_sucursalId_idx" ON "Usuario"("organizacionId", "sucursalId");
CREATE INDEX "Categoria_orgId_sucursalId_idx" ON "Categoria"("orgId", "sucursalId");
CREATE INDEX "Plato_orgId_sucursalId_idx" ON "Plato"("orgId", "sucursalId");
CREATE INDEX "Mesa_orgId_sucursalId_idx" ON "Mesa"("orgId", "sucursalId");
CREATE INDEX "Pedido_orgId_sucursalId_idx" ON "Pedido"("orgId", "sucursalId");

ALTER TABLE "Sucursal" ADD CONSTRAINT "Sucursal_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Plato" ADD CONSTRAINT "Plato_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Plato" ADD CONSTRAINT "Plato_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Mesa" ADD CONSTRAINT "Mesa_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Mesa" ADD CONSTRAINT "Mesa_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
