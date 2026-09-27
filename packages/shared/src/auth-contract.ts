import { z } from "zod";

export const tenantSchema = z.object({ orgId: z.string().uuid(), sucursalId: z.string().uuid() });
export type TenantContext = z.infer<typeof tenantSchema>;

export const rolUsuarioSchema = z.enum(["admin", "caja", "mozo", "cocina"]);
export type RolUsuario = z.infer<typeof rolUsuarioSchema>;

export const authSessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  user: tenantSchema.extend({ id: z.string().uuid(), nombre: z.string(), email: z.string().email(), rol: rolUsuarioSchema }),
});
export type AuthSession = z.infer<typeof authSessionSchema>;
