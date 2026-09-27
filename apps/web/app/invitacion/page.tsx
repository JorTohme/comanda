"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { acceptInvitation } from "@comanda/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function InvitationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [nombre, setNombre] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const token = searchParams.get("token");
    if (!token) {
      setError("El enlace de invitación no es válido.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setSubmitting(true);
    try {
      const session = await acceptInvitation(API_URL, { token, nombre, password });
      window.localStorage.setItem("comanda.accessToken", session.accessToken);
      window.localStorage.setItem("comanda.refreshToken", session.refreshToken);
      window.localStorage.setItem("comanda.user", JSON.stringify(session.user));
      router.replace("/");
      router.refresh();
    } catch {
      setError("La invitación no es válida o ya venció.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto max-w-md space-y-6 rounded-2xl border border-hairline bg-surface p-6 shadow-sm">
      <div className="space-y-2">
        <h1 className="font-serif text-2xl font-semibold text-ink">Activá tu cuenta</h1>
        <p className="text-sm text-muted">Elegí tu nombre y una contraseña para ingresar a Comanda.</p>
      </div>
      <form className="space-y-4" onSubmit={submit}>
        <label className="block space-y-1 text-sm font-medium text-ink">
          Nombre
          <input
            className="w-full rounded-lg border border-hairline bg-bg px-3 py-2 font-normal focus:border-accent focus:outline-none"
            value={nombre}
            onChange={(event) => setNombre(event.target.value)}
            autoComplete="name"
            required
          />
        </label>
        <label className="block space-y-1 text-sm font-medium text-ink">
          Contraseña
          <input
            className="w-full rounded-lg border border-hairline bg-bg px-3 py-2 font-normal focus:border-accent focus:outline-none"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={12}
            required
          />
        </label>
        <label className="block space-y-1 text-sm font-medium text-ink">
          Repetir contraseña
          <input
            className="w-full rounded-lg border border-hairline bg-bg px-3 py-2 font-normal focus:border-accent focus:outline-none"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            minLength={12}
            required
          />
        </label>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <button className="w-full rounded-full bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-60" type="submit" disabled={submitting}>
          {submitting ? "Activando…" : "Activar cuenta"}
        </button>
      </form>
    </section>
  );
}

export default function InvitationPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Cargando invitación…</p>}>
      <InvitationForm />
    </Suspense>
  );
}
