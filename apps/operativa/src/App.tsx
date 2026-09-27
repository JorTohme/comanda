import { lazy, Suspense, useEffect, useState } from "react";
import type { AuthSession } from "@comanda/shared";
import { logout, setSessionExpiredHandler } from "@comanda/shared";
import { API_URL } from "./config";
import { LoginScreen } from "./LoginScreen";
const MozoView = lazy(() => import("./MozoView").then((module) => ({ default: module.MozoView })));
const CocinaView = lazy(() => import("./CocinaView").then((module) => ({ default: module.CocinaView })));
import { UnsupportedRoleScreen } from "./UnsupportedRoleScreen";

const SESSION_KEY = "comanda.session";
const TOKEN_KEY = "comanda.accessToken";
const TOKEN_KEY_REFRESH = "comanda.refreshToken";

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
    localStorage.setItem(TOKEN_KEY_REFRESH, newSession.refreshToken);
    localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
    setSession(newSession);
  }

  function handleLogout() {
    const refreshToken = localStorage.getItem(TOKEN_KEY_REFRESH);
    if (refreshToken) logout(API_URL, refreshToken).catch(() => {});
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY_REFRESH);
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }

  useEffect(() => setSessionExpiredHandler(handleLogout), []);

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (session.user.rol === "mozo") {
    return <Suspense fallback={<p className="pantalla text-muted">Cargando...</p>}><MozoView session={session} onLogout={handleLogout} /></Suspense>;
  }

  if (session.user.rol === "cocina") {
    return <Suspense fallback={<p className="pantalla text-muted">Cargando...</p>}><CocinaView session={session} onLogout={handleLogout} /></Suspense>;
  }

  return <UnsupportedRoleScreen session={session} onLogout={handleLogout} />;
}
