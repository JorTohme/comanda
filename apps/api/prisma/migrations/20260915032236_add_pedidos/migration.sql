-- CreateEnum
CREATE TYPE "TipoServicio" AS ENUM ('mesa', 'barra');

-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('abierto', 'enviado_a_cocina', 'en_preparacion', 'listo', 'entregado', 'cobrado', 'cerrado');

-- CreateTable
CREATE TABLE "Pedido" (
    "id" TEXT NOT NULL,
    "tipoServicio" "TipoServicio" NOT NULL,
    "mesaId" TEXT,
    "estado" "EstadoPedido" NOT NULL DEFAULT 'abierto',
    "orgId" TEXT,
    "sucursalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemPedido" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "platoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "precioUnitario" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "ItemPedido_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_mesaId_fkey" FOREIGN KEY ("mesaId") REFERENCES "Mesa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPedido" ADD CONSTRAINT "ItemPedido_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPedido" ADD CONSTRAINT "ItemPedido_platoId_fkey" FOREIGN KEY ("platoId") REFERENCES "Plato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
