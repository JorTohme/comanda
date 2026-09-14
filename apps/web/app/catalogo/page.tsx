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

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const FORM_VACIO = { nombre: "", precioPesos: "", categoriaId: "", disponible: true };

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
      <main>
        <h1>Catálogo</h1>
        <p>Cargando...</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Catálogo</h1>

      {error && (
        <p role="alert" style={{ color: "red" }}>
          {error}
        </p>
      )}

      <section>
        <h2>Categorías</h2>
        <form onSubmit={handleCrearCategoria}>
          <input
            type="text"
            placeholder="Nombre de categoría"
            value={nuevaCategoria}
            onChange={(e) => setNuevaCategoria(e.target.value)}
            required
          />
          <button type="submit">Agregar categoría</button>
        </form>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {categorias.map((categoria) => (
              <tr key={categoria.id}>
                <td>{categoria.nombre}</td>
                <td>
                  <button type="button" onClick={() => handleEliminarCategoria(categoria.id)}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Platos</h2>
        <form onSubmit={handleSubmitPlato}>
          <input
            type="text"
            placeholder="Nombre del plato"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            required
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="Precio (pesos)"
            value={form.precioPesos}
            onChange={(e) => setForm({ ...form, precioPesos: e.target.value })}
            required
          />
          <select
            value={form.categoriaId}
            onChange={(e) => setForm({ ...form, categoriaId: e.target.value })}
            required
          >
            <option value="">Seleccionar categoría</option>
            {categorias.map((categoria) => (
              <option key={categoria.id} value={categoria.id}>
                {categoria.nombre}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={form.disponible}
              onChange={(e) => setForm({ ...form, disponible: e.target.checked })}
            />
            Disponible
          </label>
          <button type="submit">{editandoPlatoId ? "Guardar cambios" : "Agregar plato"}</button>
          {editandoPlatoId && (
            <button type="button" onClick={handleCancelarEdicion}>
              Cancelar
            </button>
          )}
        </form>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Precio</th>
              <th>Categoría</th>
              <th>Disponible</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {platos.map((plato) => (
              <tr key={plato.id}>
                <td>{plato.nombre}</td>
                <td>{centavosToPesos(plato.precio)}</td>
                <td>{nombreCategoria(plato.categoriaId)}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={plato.disponible}
                    onChange={() => handleToggleDisponible(plato)}
                  />
                </td>
                <td>
                  <button type="button" onClick={() => handleEditarPlato(plato)}>
                    Editar
                  </button>
                  <button type="button" onClick={() => handleEliminarPlato(plato.id)}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function mensajeDeError(err: unknown): string {
  return err instanceof Error ? err.message : "Error inesperado";
}
