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

  if (authenticated) return <button type="button" className="text-sm text-slate-600" onClick={() => { window.localStorage.removeItem("comanda.accessToken"); window.location.reload(); }}>Cerrar sesión</button>;
  return <form className="flex items-center gap-2" onSubmit={submit}>
    <input aria-label="Email" className="w-40 rounded border px-2 py-1 text-sm" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
    <input aria-label="Contraseña" className="w-32 rounded border px-2 py-1 text-sm" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
    <button className="rounded bg-slate-900 px-2 py-1 text-sm text-white" type="submit">Ingresar</button>
    {error && <span className="text-xs text-red-600">{error}</span>}
  </form>;
}
