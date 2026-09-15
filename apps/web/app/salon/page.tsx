"use client";

import { useEffect, useState } from "react";
import {
  createMesa,
  deleteMesa,
  listMesas,
  updateMesa,
  type EstadoMesa,
  type Mesa,
} from "@comanda/shared";
import { PageHeader } from "../_components/PageHeader";
import { ErrorBanner } from "../_components/ErrorBanner";
import { Card } from "../_components/Card";
import { Button } from "../_components/Button";
import { Badge } from "../_components/Badge";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const FORM_VACIO = { nombre: "", capacidad: "" };

const INPUT_CLASSES =
  "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

const ESTADO_MESA_TONE: Record<EstadoMesa, { classes: string; badge: "success" | "danger" | "warning" }> = {
  libre: { classes: "border-emerald-200 bg-emerald-50 text-emerald-900", badge: "success" },
  ocupada: { classes: "border-rose-200 bg-rose-50 text-rose-900", badge: "danger" },
  pedido_en_curso: { classes: "border-amber-200 bg-amber-50 text-amber-900", badge: "warning" },
};

const LABEL_ESTADO: Record<EstadoMesa, string> = {
  libre: "Libre",
  ocupada: "Ocupada",
  pedido_en_curso: "Pedido en curso",
};

// Ciclo fijo; pedido_en_curso es aseverado por el operador, nada lo dispara solo.
const SIGUIENTE_ESTADO: Record<EstadoMesa, EstadoMesa> = {
  libre: "ocupada",
  ocupada: "pedido_en_curso",
  pedido_en_curso: "libre",
};

export default function SalonPage() {
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [form, setForm] = useState(FORM_VACIO);
  const [editandoMesaId, setEditandoMesaId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    listMesas(API_URL)
      .then(setMesas)
      .catch((err: unknown) => setError(mensajeDeError(err)))
      .finally(() => setCargando(false));
  }, []);

  async function handleCiclarEstado(mesa: Mesa) {
    setError(null);
    try {
      const actualizada = await updateMesa(API_URL, mesa.id, {
        estado: SIGUIENTE_ESTADO[mesa.estado],
      });
      setMesas(mesas.map((m) => (m.id === actualizada.id ? actualizada : m)));
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  async function handleSubmitMesa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input = {
      nombre: form.nombre,
      capacidad: Number.parseInt(form.capacidad, 10),
    };
    try {
      if (editandoMesaId) {
        const actualizada = await updateMesa(API_URL, editandoMesaId, input);
        setMesas(mesas.map((m) => (m.id === actualizada.id ? actualizada : m)));
      } else {
        const creada = await createMesa(API_URL, input);
        setMesas([...mesas, creada]);
      }
      setForm(FORM_VACIO);
      setEditandoMesaId(null);
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  function handleEditarMesa(mesa: Mesa) {
    setEditandoMesaId(mesa.id);
    setForm({ nombre: mesa.nombre, capacidad: String(mesa.capacidad) });
  }

  function handleCancelarEdicion() {
    setEditandoMesaId(null);
    setForm(FORM_VACIO);
  }

  async function handleEliminarMesa(id: string) {
    setError(null);
    try {
      await deleteMesa(API_URL, id);
      setMesas(mesas.filter((m) => m.id !== id));
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  if (cargando) {
    return (
      <div className="space-y-8">
        <PageHeader title="Salón" />
        <p className="text-sm text-slate-500">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Salón" />

      <ErrorBanner message={error} />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Mesas</h2>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 list-none p-0">
          {mesas.map((mesa) => (
            <li key={mesa.id}>
              <button
                type="button"
                onClick={() => handleCiclarEstado(mesa)}
                className={`w-full rounded-lg border p-4 text-left transition hover:opacity-90 ${ESTADO_MESA_TONE[mesa.estado].classes}`}
              >
                <strong>{mesa.nombre}</strong>
                <br />
                Capacidad: {mesa.capacidad}
                <br />
                <Badge tone={ESTADO_MESA_TONE[mesa.estado].badge}>{LABEL_ESTADO[mesa.estado]}</Badge>
              </button>
              <div className="mt-2 flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => handleEditarMesa(mesa)}>
                  Editar
                </Button>
                <Button variant="danger" size="sm" onClick={() => handleEliminarMesa(mesa.id)}>
                  Eliminar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Agregar mesa</h2>
        <form className="flex flex-wrap items-end gap-3" onSubmit={handleSubmitMesa}>
          <input
            type="text"
            placeholder="Nombre de mesa"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            required
            className={INPUT_CLASSES}
          />
          <input
            type="number"
            min={1}
            placeholder="Capacidad"
            value={form.capacidad}
            onChange={(e) => setForm({ ...form, capacidad: e.target.value })}
            required
            className={INPUT_CLASSES}
          />
          <Button type="submit">{editandoMesaId ? "Guardar cambios" : "Agregar mesa"}</Button>
          {editandoMesaId && (
            <Button type="button" variant="secondary" onClick={handleCancelarEdicion}>
              Cancelar
            </Button>
          )}
        </form>
      </Card>
    </div>
  );
}

function mensajeDeError(err: unknown): string {
  return err instanceof Error ? err.message : "Error inesperado";
}
