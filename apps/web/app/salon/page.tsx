"use client";

import { useEffect, useRef, useState } from "react";
import {
  connectRealtime,
  createMesa,
  deleteMesa,
  listMesas,
  posicionPorDefecto,
  updateMesa,
  type EstadoMesa,
  type FormaMesa,
  type Mesa,
} from "@comanda/shared";
import { PageHeader } from "../_components/PageHeader";
import { ErrorBanner } from "../_components/ErrorBanner";
import { Card } from "../_components/Card";
import { Button } from "../_components/Button";
import { Badge } from "../_components/Badge";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const FORM_VACIO = { nombre: "", capacidad: "", forma: "rect" as FormaMesa, ancho: "70", alto: "70", rotacion: "0" };

const INPUT_CLASSES =
  "rounded-full border border-hairline bg-bg px-4 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

const ESTADO_MESA_TONE: Record<EstadoMesa, { classes: string; badge: "success" | "danger" | "warning" }> = {
  libre: { classes: "border-hairline bg-surface text-ink", badge: "success" },
  ocupada: { classes: "border-danger/30 bg-danger-light text-danger", badge: "danger" },
  pedido_en_curso: { classes: "border-accent bg-accent/10 text-accent-hover", badge: "warning" },
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

const UMBRAL_DRAG_PX = 4;

function clamp(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

function posicionMesa(mesa: Mesa, index: number): { x: number; y: number } {
  if (mesa.posX != null && mesa.posY != null) return { x: mesa.posX, y: mesa.posY };
  return posicionPorDefecto(index);
}

export default function SalonPage() {
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [form, setForm] = useState(FORM_VACIO);
  const [editandoMesaId, setEditandoMesaId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [posicionArrastre, setPosicionArrastre] = useState<{ id: string; x: number; y: number } | null>(null);

  const contenedorRef = useRef<HTMLDivElement>(null);
  const arrastreRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; movido: boolean } | null>(
    null,
  );

  useEffect(() => {
    listMesas(API_URL)
      .then(setMesas)
      .catch((err: unknown) => setError(mensajeDeError(err)))
      .finally(() => setCargando(false));

    const token = window.localStorage.getItem("comanda.accessToken");
    if (!token) return;
    const socket = connectRealtime(API_URL, token);
    socket.on("mesa.actualizada", (mesa: Mesa) => {
      setMesas((prev) => {
        const idx = prev.findIndex((m) => m.id === mesa.id);
        if (idx === -1) return [...prev, mesa];
        return prev.map((m) => (m.id === mesa.id ? mesa : m));
      });
    });
    return () => {
      socket.disconnect();
    };
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

  function handlePointerDownMesa(e: React.PointerEvent, mesa: Mesa, pos: { x: number; y: number }) {
    (e.target as Element).setPointerCapture(e.pointerId);
    arrastreRef.current = { id: mesa.id, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y, movido: false };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const arr = arrastreRef.current;
    if (!arr || !contenedorRef.current) return;
    const rect = contenedorRef.current.getBoundingClientRect();
    const dxPct = ((e.clientX - arr.startX) / rect.width) * 100;
    const dyPct = ((e.clientY - arr.startY) / rect.height) * 100;
    if (!arr.movido && Math.hypot(e.clientX - arr.startX, e.clientY - arr.startY) > UMBRAL_DRAG_PX) arr.movido = true;
    if (arr.movido) {
      setPosicionArrastre({ id: arr.id, x: clamp(arr.origX + dxPct, 0, 100), y: clamp(arr.origY + dyPct, 0, 100) });
    }
  }

  async function handlePointerUpMesa(mesa: Mesa) {
    const arr = arrastreRef.current;
    arrastreRef.current = null;
    if (!arr) return;
    if (arr.movido) {
      const destino = posicionArrastre?.id === mesa.id ? posicionArrastre : null;
      setPosicionArrastre(null);
      if (!destino) return;
      setError(null);
      try {
        const actualizada = await updateMesa(API_URL, mesa.id, { posX: destino.x, posY: destino.y });
        setMesas(mesas.map((m) => (m.id === actualizada.id ? actualizada : m)));
      } catch (err) {
        setError(mensajeDeError(err));
      }
    } else {
      await handleCiclarEstado(mesa);
    }
  }

  async function handleSubmitMesa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input = {
      nombre: form.nombre,
      capacidad: Number.parseInt(form.capacidad, 10),
      forma: form.forma,
      ancho: Number.parseFloat(form.ancho),
      alto: Number.parseFloat(form.alto),
      rotacion: Number.parseFloat(form.rotacion),
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
    setForm({
      nombre: mesa.nombre,
      capacidad: String(mesa.capacidad),
      forma: mesa.forma ?? "rect",
      ancho: String(mesa.ancho ?? 70),
      alto: String(mesa.alto ?? 70),
      rotacion: String(mesa.rotacion ?? 0),
    });
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
      if (editandoMesaId === id) handleCancelarEdicion();
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  if (cargando) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Gestión" title="Salón" />
        <p className="text-sm text-muted">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Gestión" title="Salón" description="Arrastrá una mesa para ubicarla; un click cicla su estado" />

      <ErrorBanner message={error} />

      <section className="space-y-4">
        <h2 className="font-serif text-lg font-semibold text-ink">Plano</h2>
        <div
          ref={contenedorRef}
          className="relative aspect-[16/10] w-full touch-none rounded-2xl border border-hairline bg-surface shadow-card"
          onPointerMove={handlePointerMove}
        >
          {mesas.map((mesa, index) => {
            const pos = posicionArrastre?.id === mesa.id ? posicionArrastre : posicionMesa(mesa, index);
            const tone = ESTADO_MESA_TONE[mesa.estado];
            return (
              <div
                key={mesa.id}
                onPointerDown={(e) => handlePointerDownMesa(e, mesa, pos)}
                onPointerUp={() => handlePointerUpMesa(mesa)}
                className={`absolute flex cursor-grab select-none flex-col items-center justify-center border-2 p-1 text-center text-xs font-medium shadow-card active:cursor-grabbing ${tone.classes} ${mesa.forma === "circle" ? "rounded-full" : "rounded-lg"}`}
                style={{
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  width: mesa.ancho ?? 70,
                  height: mesa.alto ?? 70,
                  transform: `translate(-50%, -50%) rotate(${mesa.rotacion ?? 0}deg)`,
                }}
              >
                <span className="font-serif text-sm">{mesa.nombre}</span>
                <span className="text-[10px] opacity-75">{mesa.capacidad}p</span>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          {mesas.map((mesa) => (
            <button
              key={mesa.id}
              type="button"
              onClick={() => handleEditarMesa(mesa)}
              className="inline-flex items-center gap-2 rounded-full border border-hairline bg-bg px-3 py-1.5 text-xs text-ink hover:border-accent"
            >
              {mesa.nombre}
              <Badge tone={ESTADO_MESA_TONE[mesa.estado].badge}>{LABEL_ESTADO[mesa.estado]}</Badge>
            </button>
          ))}
        </div>
      </section>

      <Card className="space-y-4">
        <h2 className="font-serif text-lg font-semibold text-ink">{editandoMesaId ? "Editar mesa" : "Agregar mesa"}</h2>
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
          <select
            value={form.forma}
            onChange={(e) => setForm({ ...form, forma: e.target.value as FormaMesa })}
            className={INPUT_CLASSES}
          >
            <option value="rect">Rectangular</option>
            <option value="circle">Redonda</option>
          </select>
          <input
            type="number"
            min={30}
            placeholder="Ancho (px)"
            value={form.ancho}
            onChange={(e) => setForm({ ...form, ancho: e.target.value })}
            className={INPUT_CLASSES}
            style={{ width: 120 }}
          />
          <input
            type="number"
            min={30}
            placeholder="Alto (px)"
            value={form.alto}
            onChange={(e) => setForm({ ...form, alto: e.target.value })}
            className={INPUT_CLASSES}
            style={{ width: 120 }}
          />
          <input
            type="number"
            placeholder="Rotación (°)"
            value={form.rotacion}
            onChange={(e) => setForm({ ...form, rotacion: e.target.value })}
            className={INPUT_CLASSES}
            style={{ width: 130 }}
          />
          <Button type="submit">{editandoMesaId ? "Guardar cambios" : "Agregar mesa"}</Button>
          {editandoMesaId && (
            <>
              <Button type="button" variant="secondary" onClick={handleCancelarEdicion}>
                Cancelar
              </Button>
              <Button type="button" variant="danger" onClick={() => handleEliminarMesa(editandoMesaId)}>
                Eliminar mesa
              </Button>
            </>
          )}
        </form>
      </Card>
    </div>
  );
}

function mensajeDeError(err: unknown): string {
  return err instanceof Error ? err.message : "Error inesperado";
}
