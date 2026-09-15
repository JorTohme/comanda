-- CreateEnum
CREATE TYPE "EstadoMesa" AS ENUM ('libre', 'ocupada', 'pedido_en_curso');

-- CreateTable
CREATE TABLE "Mesa" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "capacidad" INTEGER NOT NULL,
    "estado" "EstadoMesa" NOT NULL DEFAULT 'libre',
    "orgId" TEXT,
    "sucursalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mesa_pkey" PRIMARY KEY ("id")
);
