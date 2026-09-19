ALTER TABLE "RefreshToken" ADD COLUMN "sucursalId" TEXT;

UPDATE "RefreshToken" AS refresh_token
SET "sucursalId" = usuario."sucursalId"
FROM "Usuario" AS usuario
WHERE refresh_token."usuarioId" = usuario."id";

ALTER TABLE "RefreshToken" ALTER COLUMN "sucursalId" SET NOT NULL;

CREATE INDEX "RefreshToken_sucursalId_idx" ON "RefreshToken"("sucursalId");

ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_sucursalId_fkey"
FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
