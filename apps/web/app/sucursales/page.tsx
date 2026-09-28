"use client";

import { useEffect, useState } from "react";
import { crearSucursal, listSucursales, type Sucursal } from "@comanda/shared";
import { PageHeader } from "../_components/PageHeader";
import { ErrorBanner } from "../_components/ErrorBanner";
import { Card } from "../_components/Card";
import { Button } from "../_components/Button";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

const INPUT_CLASSES =
  "rounded-full border border-hairline bg-bg px-4 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

export default function SucursalesPage() {
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [nombre, setNombre] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    listSucursales(API_URL)
      .then(setSucursales)
      .catch((err: unknown) => setError(mensajeDeError(err)))
      .finally(() => setCargando(false));
  }, []);

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const sucursal = await crearSucursal(API_URL, { nombre, timezone });
      setSucursales([...sucursales, sucursal]);
      setNombre("");
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  if (cargando) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Gestión" title="Sucursales" />
        <p className="text-sm text-muted">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Gestión" title="Sucursales" description="Ramas de la organización" />

      <ErrorBanner message={error} />

      <Card className="space-y-4">
        <h2 className="font-serif text-lg font-semibold text-ink">Nueva sucursal</h2>
        <form className="flex flex-wrap items-center gap-3" onSubmit={handleCrear}>
          <input
            type="text"
            placeholder="Nombre de la sucursal"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            className={INPUT_CLASSES}
          />
          <label className="flex flex-col gap-1 text-xs text-muted">
            Zona horaria IANA
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              required
              className={INPUT_CLASSES}
            />
          </label>
          <Button type="submit">Agregar sucursal</Button>
        </form>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {sucursales.map((sucursal) => (
          <div key={sucursal.id} className="rounded-2xl border border-hairline bg-surface p-4 shadow-card">
            <div className="space-y-1">
              <span className="block font-serif text-[15px] font-semibold text-ink">{sucursal.nombre}</span>
              <span className="text-xs text-muted">{sucursal.timezone}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function mensajeDeError(err: unknown): string {
  return err instanceof Error ? err.message : "Error inesperado";
}
