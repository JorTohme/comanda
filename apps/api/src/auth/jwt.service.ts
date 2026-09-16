import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import type { RolUsuario } from "@prisma/client";

const scrypt = promisify(scryptCallback);
const encoder = new TextEncoder();

export interface JwtClaims {
  sub: string;
  orgId: string;
  sucursalId: string;
  rol: RolUsuario;
  iat: number;
  exp: number;
}

export type TenantContext = Pick<JwtClaims, "orgId" | "sucursalId">;

type JwtPayload = Omit<JwtClaims, "iat" | "exp"> & Partial<Pick<JwtClaims, "iat" | "exp">>;

function encode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

@Injectable()
export class JwtService {
  private readonly secret = process.env.JWT_SECRET ?? "development-only-change-me";

  sign(payload: Omit<JwtClaims, "iat" | "exp">): string {
    const now = Math.floor(Date.now() / 1000);
    const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = encode(JSON.stringify({ ...payload, iat: now, exp: now + 60 * 60 * 8 }));
    const content = `${header}.${body}`;
    return `${content}.${this.signature(content)}`;
  }

  verify(token: string): JwtClaims {
    const [header, body, signature, extra] = token.split(".");
    if (!header || !body || !signature || extra || !this.equal(signature, this.signature(`${header}.${body}`))) {
      throw new UnauthorizedException("Invalid access token");
    }

    let payload: JwtPayload;
    try {
      payload = JSON.parse(decode(body)) as JwtPayload;
    } catch {
      throw new UnauthorizedException("Invalid access token");
    }
    if (
      typeof payload.sub !== "string" ||
      typeof payload.orgId !== "string" ||
      typeof payload.sucursalId !== "string" ||
      !["admin", "caja", "mozo", "cocina"].includes(payload.rol ?? "") ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      throw new UnauthorizedException("Invalid or expired access token");
    }
    return payload as JwtClaims;
  }

  private signature(content: string): string {
    return createHmac("sha256", this.secret).update(content).digest("base64url");
  }

  private equal(left: string, right: string): boolean {
    const a = encoder.encode(left);
    const b = encoder.encode(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, hash] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "base64url");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
