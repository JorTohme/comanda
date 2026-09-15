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

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const FORM_VACIO = { nombre: "", precioPesos: "", categoriaId: "", disponible: true };

const INPUT_CLASSES =
  "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

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

  function nombreCategoria(categoriaId: string): string {
    return categorias.find((c) => c.id === categoriaId)?.nombre ?? categoriaId;
  }

  if (cargando) {
    return (
      <div className="space-y-8">
        <PageHeader title="Catálogo" />
        <p className="text-sm text-slate-500">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Catálogo" description="Gestioná categorías y platos" />

      <ErrorBanner message={error} />

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Categorías</h2>
        <form className="flex flex-wrap items-end gap-3" onSubmit={handleCrearCategoria}>
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Nombre</th>
                <th className="px-3 py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {categorias.map((categoria) => (
                <tr key={categoria.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">{categoria.nombre}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleEliminarCategoria(categoria.id)}
                      >
                        Eliminar
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Platos</h2>
        <form className="flex flex-wrap items-end gap-3" onSubmit={handleSubmitPlato}>
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
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.disponible}
              onChange={(e) => setForm({ ...form, disponible: e.target.checked })}
              className="accent-brand-600"
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Nombre</th>
                <th className="px-3 py-2 font-medium">Precio</th>
                <th className="px-3 py-2 font-medium">Categoría</th>
                <th className="px-3 py-2 font-medium">Disponible</th>
                <th className="px-3 py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {platos.map((plato) => (
                <tr key={plato.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">{plato.nombre}</td>
                  <td className="px-3 py-2">{centavosToPesos(plato.precio)}</td>
                  <td className="px-3 py-2">{nombreCategoria(plato.categoriaId)}</td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={plato.disponible}
                      onChange={() => handleToggleDisponible(plato)}
                      className="accent-brand-600"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" onClick={() => handleEditarPlato(plato)}>
                        Editar
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => handleEliminarPlato(plato.id)}>
                        Eliminar
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function mensajeDeError(err: unknown): string {
  return err instanceof Error ? err.message : "Error inesperado";
}
