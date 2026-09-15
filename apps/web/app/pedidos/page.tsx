"use client";

import { useEffect, useState } from "react";
import {
  avanzarEstadoPedido,
  centavosToPesos,
  createPedido,
  listMesas,
  listPedidos,
  listPlatos,
  SIGUIENTE_ESTADO_PEDIDO,
  type Mesa,
  type Pedido,
  type Plato,
  type TipoServicio,
} from "@comanda/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type ItemFormRow = { platoId: string; cantidad: string };

const ITEM_VACIO: ItemFormRow = { platoId: "", cantidad: "1" };
const FORM_VACIO: { tipoServicio: TipoServicio; mesaId: string; items: ItemFormRow[] } = {
  tipoServicio: "mesa",
  mesaId: "",
  items: [ITEM_VACIO],
};

export default function PedidosPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [platos, setPlatos] = useState<Plato[]>([]);
  const [form, setForm] = useState(FORM_VACIO);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    Promise.all([listPedidos(API_URL), listMesas(API_URL), listPlatos(API_URL)])
      .then(([pedidosRes, mesasRes, platosRes]) => {
        setPedidos(pedidosRes);
        setMesas(mesasRes);
        setPlatos(platosRes);
      })
      .catch((err: unknown) => setError(mensajeDeError(err)))
      .finally(() => setCargando(false));
  }, []);

  function totalFormulario(): number {
    return form.items.reduce((acc, item) => {
      const plato = platos.find((p) => p.id === item.platoId);
      const cantidad = Number.parseInt(item.cantidad, 10);
      if (!plato || Number.isNaN(cantidad)) return acc;
      return acc + plato.precio * cantidad;
    }, 0);
  }

  function totalPedido(pedido: Pedido): number {
    return pedido.items.reduce((acc, item) => acc + item.precioUnitario * item.cantidad, 0);
  }

  function handleAgregarFila() {
    setForm({ ...form, items: [...form.items, { ...ITEM_VACIO }] });
  }

  function handleEliminarFila(index: number) {
    setForm({ ...form, items: form.items.filter((_, i) => i !== index) });
  }

  function handleCambiarFila(index: number, cambio: Partial<ItemFormRow>) {
    setForm({
      ...form,
      items: form.items.map((item, i) => (i === index ? { ...item, ...cambio } : item)),
    });
  }

  async function handleSubmitPedido(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input = {
      tipoServicio: form.tipoServicio,
      ...(form.tipoServicio === "mesa" ? { mesaId: form.mesaId } : {}),
      items: form.items.map((item) => ({
        platoId: item.platoId,
        cantidad: Number.parseInt(item.cantidad, 10),
      })),
    };
    try {
      const creado = await createPedido(API_URL, input);
      setPedidos([...pedidos, creado]);
      setForm(FORM_VACIO);
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  async function handleAvanzar(pedido: Pedido) {
    const siguiente = SIGUIENTE_ESTADO_PEDIDO[pedido.estado];
    if (!siguiente) return;
    setError(null);
    try {
      const actualizado = await avanzarEstadoPedido(API_URL, pedido.id, siguiente);
      setPedidos(pedidos.map((p) => (p.id === actualizado.id ? actualizado : p)));
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  const mesasLibres = mesas.filter((m) => m.estado === "libre");

  if (cargando) {
    return (
      <main>
        <h1>Pedidos</h1>
        <p>Cargando...</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Pedidos</h1>

      {error && (
        <p role="alert" style={{ color: "red" }}>
          {error}
        </p>
      )}

      <section>
        <h2>Nuevo pedido</h2>
        <form onSubmit={handleSubmitPedido}>
          <select
            value={form.tipoServicio}
            onChange={(e) =>
              setForm({ ...form, tipoServicio: e.target.value as TipoServicio, mesaId: "" })
            }
          >
            <option value="mesa">Mesa</option>
            <option value="barra">Barra</option>
          </select>

          {form.tipoServicio === "mesa" && (
            <select
              value={form.mesaId}
              onChange={(e) => setForm({ ...form, mesaId: e.target.value })}
              required
            >
              <option value="">Seleccionar mesa</option>
              {mesasLibres.map((mesa) => (
                <option key={mesa.id} value={mesa.id}>
                  {mesa.nombre}
                </option>
              ))}
            </select>
          )}

          {form.items.map((item, index) => (
            <div key={index}>
              <select
                value={item.platoId}
                onChange={(e) => handleCambiarFila(index, { platoId: e.target.value })}
                required
              >
                <option value="">Seleccionar plato</option>
                {platos.map((plato) => (
                  <option key={plato.id} value={plato.id}>
                    {plato.nombre} — {centavosToPesos(plato.precio)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={item.cantidad}
                onChange={(e) => handleCambiarFila(index, { cantidad: e.target.value })}
                required
              />
              {form.items.length > 1 && (
                <button type="button" onClick={() => handleEliminarFila(index)}>
                  Quitar
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={handleAgregarFila}>
            Agregar línea
          </button>

          <p>Total: {centavosToPesos(totalFormulario())}</p>

          <button type="submit">Crear pedido</button>
        </form>
      </section>

      <section>
        <h2>Pedidos</h2>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {pedidos.map((pedido) => {
            const siguiente = SIGUIENTE_ESTADO_PEDIDO[pedido.estado];
            return (
              <li
                key={pedido.id}
                style={{ border: "1px solid #ccc", borderRadius: "4px", padding: "1rem", marginBottom: "0.75rem" }}
              >
                <strong>{pedido.tipoServicio}</strong> — {pedido.estado}
                <ul>
                  {pedido.items.map((item) => (
                    <li key={item.id}>
                      {item.nombre} × {item.cantidad} a {centavosToPesos(item.precioUnitario)}
                    </li>
                  ))}
                </ul>
                <p>Total: {centavosToPesos(totalPedido(pedido))}</p>
                {siguiente && (
                  <button type="button" onClick={() => handleAvanzar(pedido)}>
                    Avanzar a {siguiente}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}

function mensajeDeError(err: unknown): string {
  return err instanceof Error ? err.message : "Error inesperado";
}
