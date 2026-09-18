"use client";

import { useEffect, useState } from "react";

export type AuthState = "unknown" | "authenticated" | "unauthenticated";

// Single source of truth for "is there a token in localStorage" — used by AuthGate,
// AuthSession, and anything else that must not fetch (or must not flash a wrong state)
// before the client has had a chance to check.
export function useAuthenticated(): AuthState {
  const [state, setState] = useState<AuthState>("unknown");

  useEffect(() => {
    setState(window.localStorage.getItem("comanda.accessToken") ? "authenticated" : "unauthenticated");
  }, []);

  return state;
}
