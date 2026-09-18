"use client";

import { useEffect, useState } from "react";

// Mirrors apps/operativa/src/App.tsx's session gate: without this, pages fetch protected
// data unconditionally on mount, and an expired/missing session with no refresh token
// makes clearSessionAndNotify() reload the same URL forever (fetch -> 401 -> reload -> fetch...).
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    setAuthenticated(Boolean(window.localStorage.getItem("comanda.accessToken")));
  }, []);

  if (!authenticated) {
    return <p className="text-sm text-muted">Iniciá sesión para continuar.</p>;
  }

  return <>{children}</>;
}
