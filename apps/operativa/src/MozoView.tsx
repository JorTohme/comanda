import { useEffect, useState } from "react";
import {
  avanzarEstadoPedido,
  createPedido,
  listMesas,
  listPedidos,
  listPlatos,
  type AuthSession,
  type Mesa,
  type Pedido,
  type Plato,
  type TipoServicio,
} from "@comanda/shared";
import { ErrorBanner } from "./_components/ErrorBanner";
import { API_URL } from "./config";

type ItemFormRow = { platoId: string; cantidad: string };

const ITEM_VACIO: ItemFormRow = { platoId: "", cantidad: "1" };
const FORM_VACIO: { tipoServicio: TipoServicio; mesaId: string; items: ItemFormRow[] } = {
  tipoServicio: "mesa",
  mesaId: "",
  items: [ITEM_VACIO],
};

export function MozoView({ session, onLogout }: { session: AuthSession; onLogout: () => void }) {
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [platos, setPlatos] = useState<Plato[]>([]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [form, setForm] = useState(FORM_VACIO);

  function cargarDatos() {
    return Promise.all([listMesas(API_URL), listPlatos(API_URL), listPedidos(API_URL)])
      .then(([mesasRes, platosRes, pedidosRes]) => {
        setMesas(mesasRes);
        setPlatos(platosRes);
        setPedidos(pedidosRes);
      })
      .catch((err: unknown) => setError(mensajeDeError(err)));
  }

  useEffect(() => {
    cargarDatos().finally(() => setCargando(false));
    // ponytail: polling until Iter 4 wires Socket.io (PedidoEnviadoACocina/PedidoListo/etc.) — swap this interval for a socket subscription then, keep this fetch as the initial load.
    const interval = setInterval(cargarDatos, 5000);
    return () => clearInterval(interval);
  }, []);

  function recargarPedidos() {
    listPedidos(API_URL)
      .then(setPedidos)
      .catch((err: unknown) => setError(mensajeDeError(err)));
  }

  function handleAgregarFila() {
    setForm({ ...form, items: [...form.items, { ...ITEM_VACIO }] });
  }

  function handleEliminarFila(index: number) {
    setForm({ ...form, items: form.items.filter((_, i) => i !== index) });
  }

  function handleCambiarFila(index: number, cambio: Partial<ItemFormRow>) {
    setForm({ ...form, items: form.items.map((item, i) => (i === index ? { ...item, ...cambio } : item)) });
  }

  async function handleSubmitPedido(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createPedido(API_URL, {
        tipoServicio: form.tipoServicio,
        mesaId: form.tipoServicio === "mesa" ? form.mesaId : undefined,
        items: form.items.map((item) => ({ platoId: item.platoId, cantidad: Number.parseInt(item.cantidad, 10) })),
      });
      recargarPedidos();
      setForm(FORM_VACIO);
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  async function handleAvanzar(pedidoId: string, estado: "enviado_a_cocina" | "entregado") {
    setError(null);
    try {
      await avanzarEstadoPedido(API_URL, pedidoId, estado);
      recargarPedidos();
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  const mesasLibres = mesas.filter((m) => m.estado === "libre");

  return (
    <div>
      <header>
        <span>Hola, {session.user.nombre}</span>
        <button type="button" onClick={onLogout}>
          Cerrar sesión
        </button>
      </header>

      <ErrorBanner message={error} />

      {cargando ? (
        <p>Cargando...</p>
      ) : (
        <>
          <section>
            <h2>Mesas</h2>
            <ul>
              {mesas.map((mesa) => (
                <li key={mesa.id}>
                  {mesa.nombre} — {mesa.estado}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Nuevo pedido</h2>
            <form onSubmit={handleSubmitPedido}>
              <select
                value={form.tipoServicio}
                onChange={(e) => setForm({ ...form, tipoServicio: e.target.value as TipoServicio, mesaId: "" })}
              >
                <option value="mesa">Mesa</option>
                <option value="barra">Barra</option>
              </select>

              {form.tipoServicio === "mesa" && (
                <select value={form.mesaId} onChange={(e) => setForm({ ...form, mesaId: e.target.value })} required>
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
                  <select value={item.platoId} onChange={(e) => handleCambiarFila(index, { platoId: e.target.value })} required>
                    <option value="">Seleccionar plato</option>
                    {platos.map((plato) => (
                      <option key={plato.id} value={plato.id}>
                        {plato.nombre}
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

              <button type="submit">Crear pedido</button>
            </form>
          </section>

          <section>
            <h2>Pedidos</h2>
            <ul>
              {pedidos.map((pedido) => (
                <li key={pedido.id}>
                  <span>
                    {pedido.tipoServicio} — {pedido.estado}
                  </span>
                  <ul>
                    {pedido.items.map((item) => (
                      <li key={item.id}>
                        {item.nombre} × {item.cantidad}
                      </li>
                    ))}
                  </ul>
                  {pedido.estado === "abierto" && (
                    <button type="button" onClick={() => handleAvanzar(pedido.id, "enviado_a_cocina")}>
                      Enviar a cocina
                    </button>
                  )}
                  {pedido.estado === "listo" && (
                    <button type="button" onClick={() => handleAvanzar(pedido.id, "entregado")}>
                      Entregar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function mensajeDeError(err: unknown): string {
  return err instanceof Error ? err.message : "Error inesperado";
}
