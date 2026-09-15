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

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const FORM_VACIO = { nombre: "", capacidad: "" };

const COLOR_ESTADO: Record<EstadoMesa, string> = {
  libre: "#e8f5e9", // verde — disponible
  ocupada: "#ffebee", // rojo — comensales sentados
  pedido_en_curso: "#fff8e1", // ámbar — aseverado por el operador
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
      <main>
        <h1>Salón</h1>
        <p>Cargando...</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Salón</h1>

      {error && (
        <p role="alert" style={{ color: "red" }}>
          {error}
        </p>
      )}

      <section>
        <h2>Mesas</h2>
        <ul
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: "0.75rem",
            listStyle: "none",
            padding: 0,
          }}
        >
          {mesas.map((mesa) => (
            <li key={mesa.id}>
              <button
                type="button"
                onClick={() => handleCiclarEstado(mesa)}
                style={{
                  backgroundColor: COLOR_ESTADO[mesa.estado],
                  width: "100%",
                  padding: "1rem",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <strong>{mesa.nombre}</strong>
                <br />
                Capacidad: {mesa.capacidad}
                <br />
                <span>{LABEL_ESTADO[mesa.estado]}</span>
              </button>
              <button type="button" onClick={() => handleEditarMesa(mesa)}>
                Editar
              </button>
              <button type="button" onClick={() => handleEliminarMesa(mesa.id)}>
                Eliminar
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={handleSubmitMesa}>
          <input
            type="text"
            placeholder="Nombre de mesa"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            required
          />
          <input
            type="number"
            min={1}
            placeholder="Capacidad"
            value={form.capacidad}
            onChange={(e) => setForm({ ...form, capacidad: e.target.value })}
            required
          />
          <button type="submit">{editandoMesaId ? "Guardar cambios" : "Agregar mesa"}</button>
          {editandoMesaId && (
            <button type="button" onClick={handleCancelarEdicion}>
              Cancelar
            </button>
          )}
        </form>
      </section>
    </main>
  );
}

function mensajeDeError(err: unknown): string {
  return err instanceof Error ? err.message : "Error inesperado";
}
