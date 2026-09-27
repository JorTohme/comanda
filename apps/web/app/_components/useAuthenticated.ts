"use client";

import { useSession } from "./useSession";

export type AuthState = "unknown" | "authenticated" | "unauthenticated";

// Shared session state keeps protected routes from fetching or flashing before hydration.
export function useAuthenticated(): AuthState {
  const { ready, session } = useSession();
  if (!ready) return "unknown";
  return session ? "authenticated" : "unauthenticated";
}
