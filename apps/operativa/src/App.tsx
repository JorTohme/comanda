import { useState } from "react";
import type { AuthSession } from "@comanda/shared";
import { LoginScreen } from "./LoginScreen";
import { MozoView } from "./MozoView";
import { CocinaView } from "./CocinaView";
import { UnsupportedRoleScreen } from "./UnsupportedRoleScreen";

const SESSION_KEY = "comanda.session";
const TOKEN_KEY = "comanda.accessToken";

function readStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(() => readStoredSession());

  function handleLogin(newSession: AuthSession) {
    localStorage.setItem(TOKEN_KEY, newSession.accessToken);
    localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
    setSession(newSession);
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (session.user.rol === "mozo") {
    return <MozoView session={session} onLogout={handleLogout} />;
  }

  if (session.user.rol === "cocina") {
    return <CocinaView session={session} onLogout={handleLogout} />;
  }

  return <UnsupportedRoleScreen session={session} onLogout={handleLogout} />;
}
