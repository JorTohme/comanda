"use client";

import { FormEvent, useState } from "react";
import { clearSession, getSessionGeneration, login, logout, readSession, saveSession } from "@comanda/shared";
import { useSession } from "./useSession";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function AuthSession() {
  const { ready, session: currentSession } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const generation = getSessionGeneration();
    try {
      const session = await login(API_URL, { email, password });
      if (generation !== getSessionGeneration()) {
        setError("La sesión cambió mientras se iniciaba. Volvé a intentarlo.");
        return;
      }
      saveSession(session);
    } catch {
      setError("No se pudo iniciar sesión.");
    }
  }

  if (!ready) return null;

  if (currentSession)
    return (
      <button
        type="button"
        className="text-sm font-medium text-muted hover:text-ink"
        onClick={() => {
          const refreshToken = readSession()?.refreshToken;
          clearSession();
          if (refreshToken) void logout(API_URL, refreshToken).catch(() => {});
        }}
      >
        Cerrar sesión
      </button>
    );
  return (
    <form className="flex items-center gap-2" onSubmit={submit}>
      <input
        aria-label="Email"
        className="w-40 rounded-full border border-hairline bg-bg px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />
      <input
        aria-label="Contraseña"
        className="w-32 rounded-full border border-hairline bg-bg px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      <button className="rounded-full bg-ink px-3 py-1.5 text-sm font-medium text-white" type="submit">
        Ingresar
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </form>
  );
}
