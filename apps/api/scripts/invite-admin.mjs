import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const DEFAULT_EXPIRY_HOURS = 72;

function usage() {
  return [
    "Usage: pnpm --filter api invite-admin -- --org <name> --branch <name> --email <email> [--expires-hours <hours>]",
    "Creates one organization, its first branch, and a pending administrator invitation.",
  ].join("\n");
}

function parseArgs(argv) {
  const values = {};
  const args = argv.filter((value) => value !== "--");
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--help" || key === "-h") return { help: true };
    if (!key.startsWith("--") || !args[index + 1]) throw new Error(usage());
    values[key.slice(2)] = args[index + 1];
    index += 1;
  }

  const organization = values.org?.trim();
  const branch = values.branch?.trim();
  const email = values.email?.trim().toLowerCase();
  const expiryHours = values["expires-hours"] === undefined ? DEFAULT_EXPIRY_HOURS : Number(values["expires-hours"]);
  if (!organization || !branch || !email || !/^\S+@\S+\.\S+$/.test(email) || !Number.isInteger(expiryHours) || expiryHours <= 0) {
    throw new Error(usage());
  }
  return { organization, branch, email, expiryHours };
}

function invitationUrl(token) {
  const url = new URL("/invitacion", process.env.WEB_APP_URL ?? "http://localhost:3000");
  url.searchParams.set("token", token);
  return url.toString();
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  if (input.help) {
    console.log(usage());
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL environment variable must be set");

  const prisma = new PrismaClient();
  try {
    const existingOrganization = await prisma.organizacion.findFirst({ where: { nombre: input.organization }, select: { id: true } });
    if (existingOrganization) {
      throw new Error("Organization already exists; issue employee invitations from an authenticated admin account instead");
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + input.expiryHours * 60 * 60 * 1000);
    await prisma.$transaction(async (tx) => {
      const organizacion = await tx.organizacion.create({ data: { nombre: input.organization } });
      const sucursal = await tx.sucursal.create({ data: { nombre: input.branch, organizacionId: organizacion.id } });
      await tx.invitation.create({
        data: {
          tokenHash: createHash("sha256").update(token).digest("hex"),
          email: input.email,
          rol: "admin",
          organizacionId: organizacion.id,
          sucursalId: sucursal.id,
          expiresAt,
        },
      });
    });

    console.error("Share this one-time activation URL only with the intended administrator:");
    console.log(invitationUrl(token));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unable to create administrator invitation");
  process.exitCode = 1;
});
