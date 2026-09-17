"use client";

import { FormEvent, useEffect, useState } from "react";
import { login } from "@comanda/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function AuthSession() {
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setAuthenticated(Boolean(window.localStorage.getItem("comanda.accessToken"))), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const session = await login(API_URL, { email, password });
      window.localStorage.setItem("comanda.accessToken", session.accessToken);
      window.location.reload();
    } catch {
      setError("No se pudo iniciar sesión.");
    }
  }

  if (authenticated)
    return (
      <button
        type="button"
        className="text-sm font-medium text-muted hover:text-ink"
        onClick={() => {
          window.localStorage.removeItem("comanda.accessToken");
          window.location.reload();
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
