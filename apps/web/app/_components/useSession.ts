"use client";

import { useEffect, useState } from "react";
import { readSession, subscribeSession, type AuthSession } from "@comanda/shared";

export function useSession(): { ready: boolean; session: AuthSession | null } {
  const [snapshot, setSnapshot] = useState<{ ready: boolean; session: AuthSession | null }>({ ready: false, session: null });

  useEffect(() => {
    setSnapshot({ ready: true, session: readSession() });
    const unsubscribe = subscribeSession(() => {
      const next = readSession();
      setSnapshot({ ready: true, session: next });
    });
    return unsubscribe;
  }, []);

  return snapshot;
}
