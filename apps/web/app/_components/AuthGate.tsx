"use client";

import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "./useSession";

// Mirrors apps/operativa/src/App.tsx's session gate: without this, pages fetch protected
// data unconditionally on mount, and an expired/missing session with no refresh token
// makes clearSessionAndNotify() reload the same URL forever (fetch -> 401 -> reload -> fetch...).
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, session } = useSession();
  const pathname = usePathname();

  if (pathname === "/invitacion") return <>{children}</>;

  if (!ready) return null;

  if (!session) {
    return <p className="text-sm text-muted">Iniciá sesión para continuar.</p>;
  }

  const rolesByRoute: Record<string, readonly string[]> = {
    "/catalogo": ["admin", "cocina"],
    "/salon": ["admin", "mozo"],
    "/pedidos": ["admin", "caja", "mozo", "cocina"],
    "/caja": ["admin", "caja"],
    "/reportes": ["admin"],
    "/sucursales": ["admin"],
  };
  const permitted = rolesByRoute[pathname];
  if (permitted && !permitted.includes(session.user.rol)) {
    return <p className="text-sm text-muted">Tu rol no tiene permiso para acceder a esta sección.</p>;
  }

  return <Fragment key={`${session.user.id}:${session.user.orgId}:${session.user.sucursalId}`}>{children}</Fragment>;
}
