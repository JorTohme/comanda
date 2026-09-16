import { UnauthorizedException } from "@nestjs/common";
import { JwtService, hashPassword, verifyPassword } from "./jwt.service";

describe("JwtService", () => {
  const claims = {
    sub: "user-1",
    orgId: "00000000-0000-0000-0000-000000000011",
    sucursalId: "00000000-0000-0000-0000-000000000012",
    rol: "admin" as const,
  };

  it("signs and verifies tenant claims", () => {
    const jwt = new JwtService();

    expect(jwt.verify(jwt.sign(claims))).toMatchObject(claims);
  });

  it("rejects a tampered token", () => {
    const jwt = new JwtService();
    const token = jwt.sign(claims);

    expect(() => jwt.verify(`${token}x`)).toThrow(UnauthorizedException);
  });

  it("hashes passwords with a unique salt and verifies them", async () => {
    const first = await hashPassword("correct-horse-battery-staple");
    const second = await hashPassword("correct-horse-battery-staple");

    expect(first).not.toBe(second);
    await expect(verifyPassword("correct-horse-battery-staple", first)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", first)).resolves.toBe(false);
  });

  it("throws when JWT_SECRET is not set", () => {
    const original = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      expect(() => new JwtService()).toThrow("JWT_SECRET environment variable must be set");
    } finally {
      process.env.JWT_SECRET = original;
    }
  });
});
