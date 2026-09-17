-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_clientRequestId_key" ON "Pedido"("clientRequestId");
