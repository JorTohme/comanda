import type { AuthSession } from "@comanda/shared";

export function UnsupportedRoleScreen({ session, onLogout }: { session: AuthSession; onLogout: () => void }) {
  return (
    <div>
      <p>Esta app es para mozos y cocina. Usá la consola web administrativa.</p>
      <p>
        Ingresaste como {session.user.nombre} ({session.user.rol}).
      </p>
      <button type="button" onClick={onLogout}>
        Cerrar sesión
      </button>
    </div>
  );
}
