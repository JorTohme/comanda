import type { AuthSession } from "@comanda/shared";

export function UnsupportedRoleScreen({ session, onLogout }: { session: AuthSession; onLogout: () => void }) {
  return (
    <div className="login-pantalla">
      <div className="card" style={{ maxWidth: 360, textAlign: "center" }}>
        <p>Esta app es para mozos y cocina. Usá la consola web administrativa.</p>
        <p className="text-muted">
          Ingresaste como {session.user.nombre} ({session.user.rol}).
        </p>
        <button type="button" className="btn btn-secondary" onClick={onLogout}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
