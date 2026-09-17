import { useState, type FormEvent } from "react";
import { login, type AuthSession } from "@comanda/shared";
import { API_URL } from "./config";
import { ErrorBanner } from "./_components/ErrorBanner";

export function LoginScreen({ onLogin }: { onLogin: (session: AuthSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const session = await login(API_URL, { email, password });
      onLogin(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setCargando(false);
    }
  }

  return (
    <main className="login-pantalla">
      <div className="login-marca">
        <div className="login-circulo">CO</div>
        <h1>Comanda</h1>
        <p className="text-muted">Consola operativa — Mozo y Cocina</p>
      </div>

      <form onSubmit={handleSubmit} className="login-form">
        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="login-password">Contraseña</label>
          <input
            id="login-password"
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        <ErrorBanner message={error} />

        <button type="submit" className="btn btn-primary btn-block" disabled={cargando}>
          {cargando ? "Ingresando..." : "Entrar"}
        </button>
        <p className="text-muted" style={{ fontSize: 14, margin: 0 }}>
          Tu rol lo define la cuenta. Si sos cocina, entrás directo al tablero.
        </p>
      </form>
    </main>
  );
}
