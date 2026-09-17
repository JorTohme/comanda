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
  type EstadoPedido,
  type Mesa,
  type Pedido,
  type Plato,
  type TipoServicio,
} from "@comanda/shared";
import { PageHeader } from "../_components/PageHeader";
import { ErrorBanner } from "../_components/ErrorBanner";
import { Card } from "../_components/Card";
import { Button } from "../_components/Button";
import { Badge } from "../_components/Badge";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const INPUT_CLASSES =
  "rounded-full border border-hairline bg-bg px-4 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

const ESTADO_PEDIDO_TONE: Record<EstadoPedido, "neutral" | "info" | "success" | "warning" | "danger" | "brand"> = {
  abierto: "neutral",
  enviado_a_cocina: "info",
  en_preparacion: "info",
  listo: "warning",
  entregado: "brand",
  cobrado: "success",
  cerrado: "neutral",
};

const LABEL_ESTADO_PEDIDO: Record<EstadoPedido, string> = {
  abierto: "Abierto",
  enviado_a_cocina: "En cocina",
  en_preparacion: "En preparación",
  listo: "Listo",
  entregado: "Entregado",
  cobrado: "Cobrado",
  cerrado: "Cerrado",
};

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
      <div className="space-y-8">
        <PageHeader eyebrow="Operación" title="Pedidos" />
        <p className="text-sm text-muted">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Operación" title="Pedidos" />

      <ErrorBanner message={error} />

      <Card className="space-y-4">
        <h2 className="font-serif text-lg font-semibold text-ink">Nuevo pedido</h2>
        <form className="space-y-3" onSubmit={handleSubmitPedido}>
          <div className="flex flex-wrap gap-3">
            <select
              value={form.tipoServicio}
              onChange={(e) =>
                setForm({ ...form, tipoServicio: e.target.value as TipoServicio, mesaId: "" })
              }
              className={INPUT_CLASSES}
            >
              <option value="mesa">Mesa</option>
              <option value="barra">Barra</option>
            </select>

            {form.tipoServicio === "mesa" && (
              <select
                value={form.mesaId}
                onChange={(e) => setForm({ ...form, mesaId: e.target.value })}
                required
                className={INPUT_CLASSES}
              >
                <option value="">Seleccionar mesa</option>
                {mesasLibres.map((mesa) => (
                  <option key={mesa.id} value={mesa.id}>
                    {mesa.nombre}
                  </option>
                ))}
              </select>
            )}
          </div>

          {form.items.map((item, index) => (
            <div key={index} className="flex items-center gap-3">
              <select
                value={item.platoId}
                onChange={(e) => handleCambiarFila(index, { platoId: e.target.value })}
                required
                className={INPUT_CLASSES}
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
                className={INPUT_CLASSES}
              />
              {form.items.length > 1 && (
                <Button type="button" variant="danger" size="sm" onClick={() => handleEliminarFila(index)}>
                  Quitar
                </Button>
              )}
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={handleAgregarFila}>
            Agregar línea
          </Button>

          <p className="font-serif text-lg font-semibold text-accent">Total: {centavosToPesos(totalFormulario())}</p>

          <Button type="submit">Crear pedido</Button>
        </form>
      </Card>

      <section className="space-y-4">
        <h2 className="font-serif text-lg font-semibold text-ink">Pedidos</h2>
        <div className="space-y-3">
          {pedidos.map((pedido) => {
            const siguiente = SIGUIENTE_ESTADO_PEDIDO[pedido.estado];
            return (
              <Card key={pedido.id}>
                <div className="flex items-center justify-between">
                  <span className="font-serif font-semibold capitalize text-ink">{pedido.tipoServicio}</span>
                  <Badge tone={ESTADO_PEDIDO_TONE[pedido.estado]}>{LABEL_ESTADO_PEDIDO[pedido.estado]}</Badge>
                </div>
                <ul className="mt-2 space-y-1 text-sm text-muted">
                  {pedido.items.map((item) => (
                    <li key={item.id}>
                      {item.nombre} × {item.cantidad} a {centavosToPesos(item.precioUnitario)}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 font-medium text-ink">Total: {centavosToPesos(totalPedido(pedido))}</p>
                {siguiente && (
                  <Button size="sm" className="mt-3" onClick={() => handleAvanzar(pedido)}>
                    Avanzar a {LABEL_ESTADO_PEDIDO[siguiente]}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function mensajeDeError(err: unknown): string {
  return err instanceof Error ? err.message : "Error inesperado";
}
