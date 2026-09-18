// Seed de datos de referencia para desarrollo/demo. Idempotente: si ya existe una
// organización con ORG_NOMBRE, la borra por completo (en el orden que respeta las FK
// Restrict del schema) antes de recrearla. No toca ninguna otra organización de la base.
//
// Uso (desde la raíz del repo, con Postgres corriendo):
//   node --env-file=apps/api/.env apps/api/prisma/seed.mjs
import { PrismaClient } from "@prisma/client";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);

const ORG_NOMBRE = "Asador Don Mario";
const PASSWORD = "Comanda2026!";
const SUCURSALES = ["Belgrano", "Palermo", "Recoleta"];

const MENU = [
  { categoria: "Entradas", platos: [
    ["Empanadas de carne (x1)", 2500],
    ["Empanadas de jamón y queso (x1)", 2500],
    ["Provoleta", 6800],
    ["Rabas", 9500],
  ] },
  { categoria: "Parrilla", platos: [
    ["Bife de chorizo", 18500],
    ["Asado de tira", 16000],
    ["Vacío", 15500],
    ["Pollo al disco", 13000],
  ] },
  { categoria: "Pastas", platos: [
    ["Ñoquis con salsa", 9800],
    ["Sorrentinos de jamón y queso", 10500],
    ["Ravioles de verdura", 9800],
    ["Tallarines con tuco", 8900],
  ] },
  { categoria: "Ensaladas", platos: [
    ["Ensalada César", 8500],
    ["Ensalada mixta", 6500],
    ["Ensalada caprese", 7800],
  ] },
  { categoria: "Postres", platos: [
    ["Flan casero", 4500],
    ["Tiramisú", 5800],
    ["Helado (2 bochas)", 4200],
    ["Panqueque con dulce de leche", 4800],
  ] },
  { categoria: "Bebidas", platos: [
    ["Agua mineral", 2500],
    ["Coca-Cola", 3200],
    ["Cerveza Quilmes", 3800],
    ["Vino de la casa (copa)", 4500],
    ["Café", 2200],
  ] },
];

const STAFF = {
  Belgrano: { caja: "Lucía Gómez", mozo: "Tomás Ibáñez", cocina: "Valentina Rossi" },
  Palermo: { caja: "Camila Torres", mozo: "Nicolás Medina", cocina: "Sofía Acosta" },
  Recoleta: { caja: "Martina López", mozo: "Franco Díaz", cocina: "Agustín Romero" },
};

const DELIVERY_PLATAFORMAS = ["PedidosYa", "Rappi"];
const DIRECCIONES = {
  Belgrano: ["Av. Cabildo 2450", "Juramento 1820", "Sucre 1290"],
  Palermo: ["Av. Santa Fe 3400", "Honduras 4750", "Gorriti 5100"],
  Recoleta: ["Av. Callao 1500", "Vicente López 1900", "Junín 1200"],
};

async function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function horaPico() {
  const r = Math.random();
  if (r < 0.5) return randInt(12, 14);
  if (r < 0.85) return randInt(20, 23);
  return randInt(9, 23);
}

function itemsPara(platos, n) {
  const items = [];
  for (let i = 0; i < n; i++) {
    const plato = pick(platos);
    items.push({ platoId: plato.id, nombre: plato.nombre, precioUnitario: plato.precio, cantidad: randInt(1, 3) });
  }
  return items;
}

function extraDelivery(sucursalNombre) {
  return Math.random() < 0.5
    ? { plataforma: pick(DELIVERY_PLATAFORMAS) }
    : { direccionEnvio: pick(DIRECCIONES[sucursalNombre]) };
}

async function wipeExisting() {
  const existing = await prisma.organizacion.findFirst({ where: { nombre: ORG_NOMBRE } });
  if (!existing) return;
  const orgId = existing.id;
  console.log(`Encontrado seed previo de "${ORG_NOMBRE}" — lo reemplazo...`);
  // Orden que respeta las FK onDelete: Restrict del schema (ver prisma/schema.prisma).
  await prisma.pago.deleteMany({ where: { orgId } });
  await prisma.pedido.deleteMany({ where: { orgId } }); // cascada: ItemPedido
  await prisma.turnoCaja.deleteMany({ where: { orgId } }); // cascada: MovimientoCaja
  await prisma.mesa.deleteMany({ where: { orgId } });
  await prisma.plato.deleteMany({ where: { orgId } });
  await prisma.categoria.deleteMany({ where: { orgId } });
  await prisma.usuario.deleteMany({ where: { organizacionId: orgId } }); // cascada: RefreshToken
  await prisma.organizacion.delete({ where: { id: orgId } }); // cascada: Sucursal
}

async function seedHistorial(org, s) {
  for (let d = 1; d <= 7; d++) {
    const dia = new Date();
    dia.setDate(dia.getDate() - d);
    dia.setHours(11, 0, 0, 0);
    const cierre = new Date(dia);
    cierre.setHours(23, 30, 0, 0);

    const turno = await prisma.turnoCaja.create({
      data: { orgId: org.id, sucursalId: s.sucursal.id, estado: "abierto", montoInicial: 5_000_000, abiertoPorId: s.caja.id, abiertoEn: dia },
    });

    let total = 0;
    const cantidadPedidos = randInt(12, 20);
    for (let i = 0; i < cantidadPedidos; i++) {
      const fecha = new Date(dia);
      fecha.setHours(horaPico(), randInt(0, 59), 0, 0);

      const tipo = pick(["mesa", "mesa", "mesa", "barra", "takeaway", "delivery"]);
      const mesa = tipo === "mesa" ? pick(s.mesas) : null;
      const items = itemsPara(s.platos, randInt(1, 3));
      total += items.reduce((acc, it) => acc + it.precioUnitario * it.cantidad, 0);

      await prisma.pedido.create({
        data: {
          tipoServicio: tipo,
          mesaId: mesa?.id ?? null,
          estado: "cobrado",
          orgId: org.id,
          sucursalId: s.sucursal.id,
          turnoCajaId: turno.id,
          createdAt: fecha,
          updatedAt: fecha,
          items: { create: items },
          ...(tipo === "delivery" ? extraDelivery(s.sucursal.nombre) : {}),
        },
      });
    }

    const totalCalculado = 5_000_000 + total;
    await prisma.turnoCaja.update({
      where: { id: turno.id },
      data: { estado: "cerrado", cerradoPorId: s.caja.id, cerradoEn: cierre, montoDeclarado: totalCalculado, totalCalculado, diferencia: 0 },
    });
  }
}

async function seedTurnoAbiertoYPedidosVivos(org, s) {
  const turno = await prisma.turnoCaja.create({
    data: { orgId: org.id, sucursalId: s.sucursal.id, estado: "abierto", montoInicial: 5_000_000, abiertoPorId: s.caja.id },
  });

  const estadosVivos = ["abierto", "abierto", "enviado_a_cocina", "enviado_a_cocina", "en_preparacion", "en_preparacion", "listo", "entregado"];
  const mesasUsadas = new Set();
  for (const estado of estadosVivos) {
    const tipo = pick(["mesa", "mesa", "barra", "takeaway", "delivery"]);
    const mesa = tipo === "mesa" ? pick(s.mesas.filter((m) => !mesasUsadas.has(m.id))) ?? pick(s.mesas) : null;
    await prisma.pedido.create({
      data: {
        tipoServicio: tipo,
        mesaId: mesa?.id ?? null,
        estado,
        orgId: org.id,
        sucursalId: s.sucursal.id,
        items: { create: itemsPara(s.platos, randInt(1, 3)) },
        ...(tipo === "delivery" ? extraDelivery(s.sucursal.nombre) : {}),
      },
    });
    // Refleja en el plano que la mesa está ocupada mientras el pedido siga activo.
    if (mesa && estado !== "entregado") {
      mesasUsadas.add(mesa.id);
      await prisma.mesa.update({ where: { id: mesa.id }, data: { estado: "pedido_en_curso" } });
    }
  }

  // un par de pedidos ya cobrados en el turno de hoy, para que Caja muestre actividad real
  for (let i = 0; i < 3; i++) {
    const tipo = pick(["mesa", "barra"]);
    const mesa = tipo === "mesa" ? pick(s.mesas) : null;
    await prisma.pedido.create({
      data: {
        tipoServicio: tipo,
        mesaId: mesa?.id ?? null,
        estado: "cobrado",
        orgId: org.id,
        sucursalId: s.sucursal.id,
        turnoCajaId: turno.id,
        items: { create: itemsPara(s.platos, randInt(1, 3)) },
      },
    });
  }
}

async function main() {
  await wipeExisting();

  const org = await prisma.organizacion.create({ data: { nombre: ORG_NOMBRE } });
  const passwordHash = await hashPassword(PASSWORD);

  let homeSucursalId = null;
  const sucursalData = [];

  for (const nombreSucursal of SUCURSALES) {
    console.log(`Creando sucursal ${nombreSucursal}...`);
    const sucursal = await prisma.sucursal.create({ data: { nombre: nombreSucursal, organizacionId: org.id } });
    if (!homeSucursalId) homeSucursalId = sucursal.id;

    const platos = [];
    for (const grupo of MENU) {
      const categoria = await prisma.categoria.create({ data: { nombre: grupo.categoria, orgId: org.id, sucursalId: sucursal.id } });
      for (const [nombre, pesos] of grupo.platos) {
        const plato = await prisma.plato.create({
          data: { nombre, precio: pesos * 100, categoriaId: categoria.id, orgId: org.id, sucursalId: sucursal.id },
        });
        platos.push(plato);
      }
    }

    const mesas = [];
    const capacidades = [2, 2, 4, 4, 4, 6, 6, 4, 2, 8];
    for (let i = 0; i < capacidades.length; i++) {
      const mesa = await prisma.mesa.create({
        data: {
          nombre: `Mesa ${i + 1}`,
          capacidad: capacidades[i],
          orgId: org.id,
          sucursalId: sucursal.id,
          posX: (i % 5) * 20 + 10,
          posY: Math.floor(i / 5) * 30 + 15,
        },
      });
      mesas.push(mesa);
    }

    const staff = STAFF[nombreSucursal];
    const slug = nombreSucursal.toLowerCase();
    const caja = await prisma.usuario.create({
      data: { nombre: staff.caja, email: `caja.${slug}@donmario.test`, passwordHash, rol: "caja", organizacionId: org.id, sucursalId: sucursal.id },
    });
    const mozo = await prisma.usuario.create({
      data: { nombre: staff.mozo, email: `mozo.${slug}@donmario.test`, passwordHash, rol: "mozo", organizacionId: org.id, sucursalId: sucursal.id },
    });
    const cocina = await prisma.usuario.create({
      data: { nombre: staff.cocina, email: `cocina.${slug}@donmario.test`, passwordHash, rol: "cocina", organizacionId: org.id, sucursalId: sucursal.id },
    });

    sucursalData.push({ sucursal, platos, mesas, caja, mozo, cocina });
  }

  console.log("Creando admin de organización...");
  await prisma.usuario.create({
    data: { nombre: "Mario Fernández", email: "admin@donmario.test", passwordHash, rol: "admin", organizacionId: org.id, sucursalId: homeSucursalId },
  });

  for (const s of sucursalData) {
    console.log(`Poblando historial y actividad en curso de ${s.sucursal.nombre}...`);
    await seedHistorial(org, s);
    await seedTurnoAbiertoYPedidosVivos(org, s);
  }

  console.log("Seed completo.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
