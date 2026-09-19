"use client";

import { useAuthenticated } from "./useAuthenticated";
import { usePathname } from "next/navigation";

// Mirrors apps/operativa/src/App.tsx's session gate: without this, pages fetch protected
// data unconditionally on mount, and an expired/missing session with no refresh token
// makes clearSessionAndNotify() reload the same URL forever (fetch -> 401 -> reload -> fetch...).
export function AuthGate({ children }: { children: React.ReactNode }) {
  const state = useAuthenticated();
  const pathname = usePathname();

  if (pathname === "/invitacion") return <>{children}</>;

  if (state === "unknown") return null;

  if (state === "unauthenticated") {
    return <p className="text-sm text-muted">Iniciá sesión para continuar.</p>;
  }

  return <>{children}</>;
}
