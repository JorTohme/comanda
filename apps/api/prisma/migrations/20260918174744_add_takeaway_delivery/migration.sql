-- AlterEnum
ALTER TYPE "EstadoPedido" ADD VALUE 'en_camino';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoServicio" ADD VALUE 'takeaway';
ALTER TYPE "TipoServicio" ADD VALUE 'delivery';

-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "direccionEnvio" TEXT,
ADD COLUMN     "plataforma" TEXT;
