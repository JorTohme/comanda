"use client";

import { useEffect, useState } from "react";
import { listSucursales, readSession, saveSession, switchSucursal, type Sucursal } from "@comanda/shared";
import { useSession } from "./useSession";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function SucursalSwitcher() {
  const { session } = useSession();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [currentSucursalId, setCurrentSucursalId] = useState("");

  useEffect(() => {
    if (session?.user.rol !== "admin") {
      setSucursales([]);
      return;
    }
    let active = true;
    listSucursales(API_URL)
      .then((rows) => { if (active) setSucursales(rows); })
      .catch(() => {});
    setCurrentSucursalId(session.user.sucursalId);
    return () => { active = false; };
  }, [session?.user.id, session?.user.orgId, session?.user.sucursalId, session?.user.rol]);

  if (sucursales.length <= 1) return null;

  async function handleChange(sucursalId: string) {
    const source = readSession();
    if (!source || source.user.rol !== "admin") return;
    const session = await switchSucursal(API_URL, sucursalId).catch(() => null);
    if (!session) return;
    const current = readSession();
    if (!current || current.user.id !== source.user.id || current.user.orgId !== source.user.orgId || current.user.sucursalId !== source.user.sucursalId) return;
    saveSession(session);
    window.location.reload();
  }

  return (
    <select
      aria-label="Sucursal"
      className="rounded-full border border-hairline bg-bg px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
      value={currentSucursalId}
      onChange={(event) => handleChange(event.target.value)}
    >
      {sucursales.map((sucursal) => (
        <option key={sucursal.id} value={sucursal.id}>
          {sucursal.nombre}
        </option>
      ))}
    </select>
  );
}
