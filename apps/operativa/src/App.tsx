import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { AuthSession } from "@comanda/shared";
import { clearSession, logout, readSession, saveSession, subscribeSession } from "@comanda/shared";
import { API_URL } from "./config";
import { LoginScreen } from "./LoginScreen";
const MozoView = lazy(() => import("./MozoView").then((module) => ({ default: module.MozoView })));
const CocinaView = lazy(() => import("./CocinaView").then((module) => ({ default: module.CocinaView })));
import { UnsupportedRoleScreen } from "./UnsupportedRoleScreen";
import { registerOfflineShell } from "./offline-shell";
import { activateOfflineUpdate } from "./offline-update";

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(() => readSession());
  const [updateRegistration, setUpdateRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateSafe, setUpdateSafe] = useState(false);
  const reloadAfterUpdate = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let registration: ServiceWorkerRegistration | null = null;
    const showWaitingWorker = () => {
      if (registration?.waiting) {
        setUpdateRegistration(registration);
        setUpdateAvailable(true);
      }
    };
    const handleControllerChange = () => {
      if (reloadAfterUpdate.current) window.location.reload();
    };

    void registerOfflineShell().then((registered) => {
      if (cancelled || !registered) return;
      registration = registered;
      showWaitingWorker();
      registered.addEventListener("updatefound", () => {
        const installing = registered.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed") window.setTimeout(showWaitingWorker, 0);
        });
      });
      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    }).catch(() => {});

    return () => {
      cancelled = true;
      navigator.serviceWorker?.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  async function handleActivateUpdate() {
    const registration = updateRegistration;
    if (!registration) return;
    reloadAfterUpdate.current = true;
    if (!await activateOfflineUpdate(registration, async () => updateSafe)) reloadAfterUpdate.current = false;
  }

  function handleLogin(newSession: AuthSession) {
    setUpdateSafe(false);
    saveSession(newSession);
  }

  function handleLogout() {
    setUpdateSafe(false);
    const refreshToken = readSession()?.refreshToken;
    clearSession();
    if (refreshToken) void logout(API_URL, refreshToken).catch(() => {});
  }

  useEffect(() => subscribeSession(() => setSession(readSession())), []);

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (session.user.rol === "mozo") {
    return <><OfflineUpdateNotice registration={updateAvailable ? updateRegistration : null} safe={updateSafe} onActivate={() => void handleActivateUpdate()} /><Suspense fallback={<p className="pantalla text-muted">Cargando...</p>}><MozoView key={`${session.user.id}:${session.user.orgId}:${session.user.sucursalId}`} session={session} onLogout={handleLogout} onOfflineUpdateSafetyChange={setUpdateSafe} /></Suspense></>;
  }

  if (session.user.rol === "cocina") {
    return <><OfflineUpdateNotice registration={updateAvailable ? updateRegistration : null} safe={updateSafe} onActivate={() => void handleActivateUpdate()} /><Suspense fallback={<p className="pantalla text-muted">Cargando...</p>}><CocinaView key={`${session.user.id}:${session.user.orgId}:${session.user.sucursalId}`} session={session} onLogout={handleLogout} onOfflineUpdateSafetyChange={setUpdateSafe} /></Suspense></>;
  }

  return <><OfflineUpdateNotice registration={updateAvailable ? updateRegistration : null} safe={updateSafe} onActivate={() => void handleActivateUpdate()} /><UnsupportedRoleScreen session={session} onLogout={handleLogout} /></>;
}

function OfflineUpdateNotice({ registration, safe, onActivate }: { registration: ServiceWorkerRegistration | null; safe: boolean; onActivate: () => void }) {
  if (!registration?.waiting) return null;
  return <aside role="status" aria-label="Actualización disponible" style={{ padding: "12px 16px", background: "#e1eecc", color: "#272e1b" }}>
    <span>Nueva versión disponible</span>{" "}
    <button type="button" className="btn btn-secondary" disabled={!safe} onClick={onActivate}>Actualizar</button>
    {!safe && <p>Guarde o sincronice los cambios antes de actualizar.</p>}
  </aside>;
}
