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
    <main
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          width: "20rem",
          padding: "2rem",
          border: "1px solid #ccc",
          borderRadius: "0.5rem",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Comanda — Operativa</h1>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            style={{ width: "100%" }}
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            style={{ width: "100%" }}
          />
        </label>
        <ErrorBanner message={error} />
        <button type="submit" disabled={cargando}>
          {cargando ? "Ingresando..." : "Ingresar"}
        </button>
      </form>
    </main>
  );
}
