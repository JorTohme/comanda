"use client";

import { useEffect, useState } from "react";
import {
  centavosToPesos,
  createCategoria,
  createPlato,
  deleteCategoria,
  deletePlato,
  listCategorias,
  listPlatos,
  pesosToCentavos,
  updatePlato,
  type Categoria,
  type Plato,
} from "@comanda/shared";
import { PageHeader } from "../_components/PageHeader";
import { ErrorBanner } from "../_components/ErrorBanner";
import { Card } from "../_components/Card";
import { Button } from "../_components/Button";
import { Badge } from "../_components/Badge";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const FORM_VACIO = { nombre: "", precioPesos: "", categoriaId: "", disponible: true };

const INPUT_CLASSES =
  "rounded-full border border-hairline bg-bg px-4 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

export default function CatalogoPage() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [platos, setPlatos] = useState<Plato[]>([]);
  const [form, setForm] = useState(FORM_VACIO);
  const [editandoPlatoId, setEditandoPlatoId] = useState<string | null>(null);
  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    Promise.all([listCategorias(API_URL), listPlatos(API_URL)])
      .then(([categoriasRes, platosRes]) => {
        setCategorias(categoriasRes);
        setPlatos(platosRes);
      })
      .catch((err: unknown) => setError(mensajeDeError(err)))
      .finally(() => setCargando(false));
  }, []);

  async function handleCrearCategoria(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const categoria = await createCategoria(API_URL, { nombre: nuevaCategoria });
      setCategorias([...categorias, categoria]);
      setNuevaCategoria("");
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  async function handleEliminarCategoria(id: string) {
    setError(null);
    try {
      await deleteCategoria(API_URL, id);
      setCategorias(categorias.filter((c) => c.id !== id));
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  async function handleSubmitPlato(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input = {
      nombre: form.nombre,
      precio: pesosToCentavos(form.precioPesos),
      categoriaId: form.categoriaId,
      disponible: form.disponible,
    };
    try {
      if (editandoPlatoId) {
        const actualizado = await updatePlato(API_URL, editandoPlatoId, input);
        setPlatos(platos.map((p) => (p.id === actualizado.id ? actualizado : p)));
      } else {
        const creado = await createPlato(API_URL, input);
        setPlatos([...platos, creado]);
      }
      setForm(FORM_VACIO);
      setEditandoPlatoId(null);
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  function handleEditarPlato(plato: Plato) {
    setEditandoPlatoId(plato.id);
    setForm({
      nombre: plato.nombre,
      precioPesos: centavosToPesos(plato.precio),
      categoriaId: plato.categoriaId,
      disponible: plato.disponible,
    });
  }

  function handleCancelarEdicion() {
    setEditandoPlatoId(null);
    setForm(FORM_VACIO);
  }

  async function handleToggleDisponible(plato: Plato) {
    setError(null);
    try {
      const actualizado = await updatePlato(API_URL, plato.id, { disponible: !plato.disponible });
      setPlatos(platos.map((p) => (p.id === actualizado.id ? actualizado : p)));
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  async function handleEliminarPlato(id: string) {
    setError(null);
    try {
      await deletePlato(API_URL, id);
      setPlatos(platos.filter((p) => p.id !== id));
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  if (cargando) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Gestión" title="Catálogo" />
        <p className="text-sm text-muted">Cargando...</p>
      </div>
    );
  }

  const categoriasConPlatos = categorias
    .map((categoria) => ({ categoria, platos: platos.filter((p) => p.categoriaId === categoria.id) }))
    .filter(({ platos }) => platos.length > 0);
  const sinCategoria = platos.filter((p) => !categorias.some((c) => c.id === p.categoriaId));

  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Gestión" title="Catálogo" description="Categorías y platos" />

      <ErrorBanner message={error} />

      <Card className="space-y-4">
        <h2 className="font-serif text-lg font-semibold text-ink">Categorías</h2>
        <form className="flex flex-wrap items-center gap-3" onSubmit={handleCrearCategoria}>
          <input
            type="text"
            placeholder="Nombre de categoría"
            value={nuevaCategoria}
            onChange={(e) => setNuevaCategoria(e.target.value)}
            required
            className={INPUT_CLASSES}
          />
          <Button type="submit">Agregar categoría</Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {categorias.map((categoria) => (
            <span
              key={categoria.id}
              className="inline-flex items-center gap-2 rounded-full border border-hairline bg-bg px-3 py-1.5 text-sm text-ink"
            >
              {categoria.nombre}
              <button
                type="button"
                onClick={() => handleEliminarCategoria(categoria.id)}
                className="text-muted hover:text-danger"
                aria-label={`Eliminar ${categoria.nombre}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-serif text-lg font-semibold text-ink">
          {editandoPlatoId ? "Editar plato" : "Agregar plato"}
        </h2>
        <form className="flex flex-wrap items-center gap-3" onSubmit={handleSubmitPlato}>
          <input
            type="text"
            placeholder="Nombre del plato"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            required
            className={INPUT_CLASSES}
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="Precio (pesos)"
            value={form.precioPesos}
            onChange={(e) => setForm({ ...form, precioPesos: e.target.value })}
            required
            className={INPUT_CLASSES}
          />
          <select
            value={form.categoriaId}
            onChange={(e) => setForm({ ...form, categoriaId: e.target.value })}
            required
            className={INPUT_CLASSES}
          >
            <option value="">Seleccionar categoría</option>
            {categorias.map((categoria) => (
              <option key={categoria.id} value={categoria.id}>
                {categoria.nombre}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={form.disponible}
              onChange={(e) => setForm({ ...form, disponible: e.target.checked })}
              className="accent-accent"
            />
            Disponible
          </label>
          <Button type="submit">{editandoPlatoId ? "Guardar cambios" : "Agregar plato"}</Button>
          {editandoPlatoId && (
            <Button type="button" variant="secondary" onClick={handleCancelarEdicion}>
              Cancelar
            </Button>
          )}
        </form>
      </Card>

      <div className="space-y-8">
        {categoriasConPlatos.map(({ categoria, platos: platosCategoria }) => (
          <section key={categoria.id} className="space-y-3">
            <div className="flex items-center gap-3">
              <h3 className="font-serif text-base font-semibold text-ink">{categoria.nombre}</h3>
              <div className="h-px flex-1 bg-hairline" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {platosCategoria.map((plato) => (
                <PlatoCard
                  key={plato.id}
                  plato={plato}
                  onToggleDisponible={() => handleToggleDisponible(plato)}
                  onEditar={() => handleEditarPlato(plato)}
                  onEliminar={() => handleEliminarPlato(plato.id)}
                />
              ))}
            </div>
          </section>
        ))}

        {sinCategoria.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-3">
              <h3 className="font-serif text-base font-semibold text-ink">Sin categoría</h3>
              <div className="h-px flex-1 bg-hairline" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {sinCategoria.map((plato) => (
                <PlatoCard
                  key={plato.id}
                  plato={plato}
                  onToggleDisponible={() => handleToggleDisponible(plato)}
                  onEditar={() => handleEditarPlato(plato)}
                  onEliminar={() => handleEliminarPlato(plato.id)}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function PlatoCard({
  plato,
  onToggleDisponible,
  onEditar,
  onEliminar,
}: {
  plato: Plato;
  onToggleDisponible: () => void;
  onEditar: () => void;
  onEliminar: () => void;
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <span className="font-serif text-[15px] font-semibold text-ink">{plato.nombre}</span>
        <button type="button" onClick={onEditar} className="text-muted hover:text-accent" aria-label={`Editar ${plato.nombre}`}>
          ✎
        </button>
      </div>
      <p className="mt-1 font-serif text-lg font-semibold text-accent">{centavosToPesos(plato.precio)}</p>
      <div className="mt-3 flex items-center justify-between">
        <button type="button" onClick={onToggleDisponible}>
          <Badge tone={plato.disponible ? "success" : "warning"}>{plato.disponible ? "Disponible" : "Agotado"}</Badge>
        </button>
        <button type="button" onClick={onEliminar} className="text-xs text-muted hover:text-danger">
          Eliminar
        </button>
      </div>
    </div>
  );
}

function mensajeDeError(err: unknown): string {
  return err instanceof Error ? err.message : "Error inesperado";
}
