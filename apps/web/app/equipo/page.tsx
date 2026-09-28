"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, createInvitation, getSessionGeneration, listSucursales, readSession, SessionChangedError, subscribeSession, type CreateInvitationInput, type Sucursal } from "@comanda/shared";
import { PageHeader } from "../_components/PageHeader";
import { ErrorBanner } from "../_components/ErrorBanner";
import { Card } from "../_components/Card";
import { Button } from "../_components/Button";
import { useSession } from "../_components/useSession";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const INPUT_CLASSES = "rounded-full border border-hairline bg-bg px-4 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
type InvitationForm = CreateInvitationInput;
const EMPTY_FORM: InvitationForm = { email: "", sucursalId: "", rol: "caja" };

type InvitationResult = { activationUrl: string; expiresAt: string };

export default function EquipoPage() {
  const { ready, session } = useSession();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [invitation, setInvitation] = useState<InvitationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const sessionGenerationRef = useRef(0);

  useEffect(() => {
    if (!ready || !session || session.user.rol !== "admin") {
      setSucursales([]);
      setInvitation(null);
      setForm(EMPTY_FORM);
      setCargando(false);
      return;
    }

    const actor = session.user;
    const controller = new AbortController();
    let active = true;
    let generation = getSessionGeneration();
    sessionGenerationRef.current = generation;
    const isCurrent = () => {
      const current = readSession()?.user;
      return active && !controller.signal.aborted && generation === getSessionGeneration() &&
        current?.id === actor.id && current.orgId === actor.orgId && current.sucursalId === actor.sucursalId && current.rol === "admin";
    };

    setSucursales([]);
    setInvitation(null);
    setError(null);
    setCopyMessage(null);
    setForm(EMPTY_FORM);
    setCargando(true);

    listSucursales(API_URL, { signal: controller.signal })
      .then((rows) => {
        if (!isCurrent()) return;
        const ownedBranches = rows.filter((branch) => branch.organizacionId === actor.orgId);
        setSucursales(ownedBranches);
        setForm((current) => ({ ...current, sucursalId: ownedBranches.some((branch) => branch.id === actor.sucursalId) ? actor.sucursalId : "" }));
      })
      .catch((err: unknown) => {
        if (isCurrent()) setError(mensajeDeError(err));
      })
      .finally(() => { if (isCurrent()) setCargando(false); });

    const unsubscribe = subscribeSession(() => {
      const next = readSession()?.user;
      const sameActorAndBranch = next?.id === actor.id && next.orgId === actor.orgId && next.sucursalId === actor.sucursalId && next.rol === "admin";
      if (sameActorAndBranch) {
        // A token refresh keeps the same actor and branch; let its request finish under the refreshed session.
        generation = getSessionGeneration();
        sessionGenerationRef.current = generation;
        return;
      }
      active = false;
      controller.abort();
      requestRef.current?.abort();
      setSucursales([]);
      setInvitation(null);
      setForm(EMPTY_FORM);
      setError(null);
      setCopyMessage(null);
      setCargando(false);
      setEnviando(false);
    });

    return () => {
      active = false;
      unsubscribe();
      controller.abort();
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [ready, session?.user.id, session?.user.orgId, session?.user.sucursalId, session?.user.rol]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enviando || !form.email || !form.sucursalId || session?.user.rol !== "admin") return;
    const actor = session.user;
    const controller = new AbortController();
    requestRef.current = controller;
    setError(null);
    setInvitation(null);
    setCopyMessage(null);
    setEnviando(true);
    const isCurrent = () => {
      const current = readSession()?.user;
      return !controller.signal.aborted && sessionGenerationRef.current === getSessionGeneration() &&
        current?.id === actor.id && current.orgId === actor.orgId && current.sucursalId === actor.sucursalId && current.rol === "admin";
    };

    try {
      const result = await createInvitation(API_URL, { email: form.email, sucursalId: form.sucursalId, rol: form.rol }, { signal: controller.signal });
      if (isCurrent()) setInvitation(result);
    } catch (err) {
      if (isCurrent() && !(err instanceof SessionChangedError) && !controller.signal.aborted) setError(mensajeDeError(err));
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (isCurrent()) setEnviando(false);
    }
  }

  async function copiarEnlace() {
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.activationUrl);
      setCopyMessage("Enlace copiado.");
    } catch {
      setCopyMessage("No se pudo copiar. Seleccioná y copiá el enlace manualmente.");
    }
  }

  if (!ready || !session || session.user.rol !== "admin") return null;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Gestión" title="Equipo" description="Creá enlaces de activación para el personal de tu organización." />
      <ErrorBanner message={error} />

      <Card className="space-y-4">
        <h2 className="font-serif text-lg font-semibold text-ink">Invitar a una persona</h2>
        <form className="flex flex-wrap items-end gap-3" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Email
            <input aria-label="Email" className={INPUT_CLASSES} type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Sucursal
            <select aria-label="Sucursal" className={INPUT_CLASSES} value={form.sucursalId} onChange={(event) => setForm({ ...form, sucursalId: event.target.value })} required disabled={cargando || sucursales.length === 0}>
              <option value="" disabled>Seleccioná una sucursal</option>
              {sucursales.map((branch) => <option key={branch.id} value={branch.id}>{branch.nombre}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Rol
            <select aria-label="Rol del personal" className={INPUT_CLASSES} value={form.rol} onChange={(event) => setForm({ ...form, rol: event.target.value as typeof form.rol })}>
              <option value="caja">Caja</option>
              <option value="mozo">Mozo</option>
              <option value="cocina">Cocina</option>
            </select>
          </label>
          <Button type="submit" disabled={cargando || enviando || sucursales.length === 0}>{enviando ? "Creando enlace…" : "Crear invitación"}</Button>
        </form>
        {cargando && <p className="text-sm text-muted">Cargando sucursales…</p>}
        {!cargando && sucursales.length === 0 && <p className="text-sm text-muted">No hay sucursales disponibles para invitar personal.</p>}
      </Card>

      {invitation && (
        <Card className="space-y-3">
          <h2 className="font-serif text-lg font-semibold text-ink">Enlace de activación</h2>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Enlace para compartir
            <input aria-label="Enlace de activación" className={INPUT_CLASSES} type="url" value={invitation.activationUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
          </label>
          <p className="text-sm text-muted">Válido hasta {new Date(invitation.expiresAt).toLocaleString()}.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={copiarEnlace}>Copiar enlace</Button>
            {copyMessage && <p role="status" className="text-sm text-muted">{copyMessage}</p>}
          </div>
        </Card>
      )}
    </div>
  );
}

function mensajeDeError(err: unknown): string {
  if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return "Tu autorización venció o no permite crear invitaciones. Volvé a iniciar sesión.";
  return "No se pudo completar la solicitud por un problema de conexión. Volvé a intentarlo.";
}
