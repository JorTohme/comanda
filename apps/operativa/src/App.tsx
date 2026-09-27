import { lazy, Suspense, useEffect, useState } from "react";
import type { AuthSession } from "@comanda/shared";
import { clearSession, logout, readSession, saveSession, subscribeSession } from "@comanda/shared";
import { API_URL } from "./config";
import { LoginScreen } from "./LoginScreen";
const MozoView = lazy(() => import("./MozoView").then((module) => ({ default: module.MozoView })));
const CocinaView = lazy(() => import("./CocinaView").then((module) => ({ default: module.CocinaView })));
import { UnsupportedRoleScreen } from "./UnsupportedRoleScreen";

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(() => readSession());

  function handleLogin(newSession: AuthSession) {
    saveSession(newSession);
  }

  function handleLogout() {
    const refreshToken = readSession()?.refreshToken;
    clearSession();
    if (refreshToken) void logout(API_URL, refreshToken).catch(() => {});
  }

  useEffect(() => subscribeSession(() => setSession(readSession())), []);

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (session.user.rol === "mozo") {
    return <Suspense fallback={<p className="pantalla text-muted">Cargando...</p>}><MozoView key={`${session.user.id}:${session.user.orgId}:${session.user.sucursalId}`} session={session} onLogout={handleLogout} /></Suspense>;
  }

  if (session.user.rol === "cocina") {
    return <Suspense fallback={<p className="pantalla text-muted">Cargando...</p>}><CocinaView key={`${session.user.id}:${session.user.orgId}:${session.user.sucursalId}`} session={session} onLogout={handleLogout} /></Suspense>;
  }

  return <UnsupportedRoleScreen session={session} onLogout={handleLogout} />;
}
