"use client";

import { useEffect, useState } from "react";
import { listSucursales, switchSucursal, type Sucursal } from "@comanda/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function currentUser(): { rol: string } | null {
  try {
    const raw = window.localStorage.getItem("comanda.user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function SucursalSwitcher() {
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [currentSucursalId, setCurrentSucursalId] = useState("");

  useEffect(() => {
    const user = currentUser();
    if (user?.rol !== "admin") return;
    listSucursales(API_URL)
      .then(setSucursales)
      .catch(() => {});
    try {
      const sucursalId = (JSON.parse(window.localStorage.getItem("comanda.user") ?? "null") as { sucursalId?: string } | null)?.sucursalId;
      if (sucursalId) setCurrentSucursalId(sucursalId);
    } catch {
      // ignore malformed local storage
    }
  }, []);

  if (sucursales.length <= 1) return null;

  async function handleChange(sucursalId: string) {
    const session = await switchSucursal(API_URL, sucursalId).catch(() => null);
    if (!session) return;
    window.localStorage.setItem("comanda.accessToken", session.accessToken);
    window.localStorage.setItem("comanda.refreshToken", session.refreshToken);
    window.localStorage.setItem("comanda.user", JSON.stringify(session.user));
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
