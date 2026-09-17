import { useEffect, useState } from "react";
import {
  avanzarEstadoPedido,
  connectRealtime,
  listMesas,
  listPedidos,
  listPlatos,
  posicionPorDefecto,
  type AuthSession,
  type Mesa,
  type Pedido,
  type Plato,
  type TipoServicio,
} from "@comanda/shared";
import { ErrorBanner } from "./_components/ErrorBanner";
import { API_URL } from "./config";
import { getDb } from "./db/schema";
import { useRxData } from "./db/useRxData";
import { crearPedidoOffline, setupAutoSync } from "./db/sync";

type ItemFormRow = { platoId: string; cantidad: string };

const ITEM_VACIO: ItemFormRow = { platoId: "", cantidad: "1" };
const FORM_VACIO: { tipoServicio: TipoServicio; mesaId: string; items: ItemFormRow[] } = {
  tipoServicio: "mesa",
  mesaId: "",
  items: [ITEM_VACIO],
};

const LABEL_ESTADO_MESA: Record<Mesa["estado"], string> = {
  libre: "Libre",
  ocupada: "Ocupada",
  pedido_en_curso: "En curso",
};

const LABEL_ESTADO_PEDIDO: Record<Pedido["estado"], string> = {
  abierto: "Abierto",
  enviado_a_cocina: "En cocina",
  en_preparacion: "En preparación",
  listo: "Listo",
  entregado: "Entregado",
  cobrado: "Cobrado",
  cerrado: "Cerrado",
};

export function MozoView({ session, onLogout }: { session: AuthSession; onLogout: () => void }) {
  const mesas = useRxData<Mesa>("mesas");
  const platos = useRxData<Plato>("platos");
  const pedidos = useRxData<Pedido>("pedidos");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [form, setForm] = useState(FORM_VACIO);

  function cargarDatos() {
    return Promise.all([listMesas(API_URL), listPlatos(API_URL), listPedidos(API_URL)])
      .then(async ([mesasRes, platosRes, pedidosRes]) => {
        const db = await getDb();
        await Promise.all([
          ...mesasRes.map((mesa) => db.collections.mesas.upsert(mesa)),
          ...platosRes.map((plato) => db.collections.platos.upsert(plato)),
          ...pedidosRes.map((pedido) => db.collections.pedidos.upsert(pedido)),
        ]);
      })
      .catch((err: unknown) => setError(mensajeDeError(err)));
  }

  useEffect(() => {
    cargarDatos().finally(() => setCargando(false));

    const stopAutoSync = setupAutoSync(API_URL, (err) => setError(mensajeDeError(err)));
    const socket = connectRealtime(API_URL, session.accessToken);
    socket.on("pedido.actualizado", async (pedido: Pedido) => {
      const db = await getDb();
      await db.collections.pedidos.upsert(pedido);
    });
    socket.on("mesa.actualizada", async (mesa: Mesa) => {
      const db = await getDb();
      await db.collections.mesas.upsert(mesa);
    });
    return () => {
      socket.disconnect();
      stopAutoSync();
    };
  }, []);

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
      await crearPedidoOffline(
        {
          tipoServicio: form.tipoServicio,
          mesaId: form.tipoServicio === "mesa" ? form.mesaId : undefined,
          items: form.items.map((item) => ({ platoId: item.platoId, cantidad: Number.parseInt(item.cantidad, 10) })),
        },
        { orgId: session.user.orgId, sucursalId: session.user.sucursalId },
        API_URL,
      );
      setForm(FORM_VACIO);
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  async function handleAvanzar(pedidoId: string, estado: "enviado_a_cocina" | "entregado") {
    setError(null);
    try {
      const actualizado = await avanzarEstadoPedido(API_URL, pedidoId, estado);
      const db = await getDb();
      await db.collections.pedidos.upsert(actualizado);
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  const mesasLibres = mesas.filter((m) => m.estado === "libre");

  return (
    <div className="pantalla">
      <header className="encabezado">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="avatar">{session.user.nombre.slice(0, 1).toUpperCase()}</div>
          <h1>Hola, {session.user.nombre}</h1>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onLogout}>
          Cerrar sesión
        </button>
      </header>

      <ErrorBanner message={error} />

      {cargando ? (
        <p className="text-muted">Cargando...</p>
      ) : (
        <>
          <section className="seccion">
            <div className="titulo-seccion">Mesas</div>
            <div className="plano-salon">
              {mesas.map((mesa, index) => {
                const pos =
                  mesa.posX != null && mesa.posY != null ? { x: mesa.posX, y: mesa.posY } : posicionPorDefecto(index);
                return (
                  <div
                    key={mesa.id}
                    className={`mesa-plano ${mesa.estado} ${mesa.forma === "circle" ? "circle" : ""}`}
                    style={{
                      left: `${pos.x}%`,
                      top: `${pos.y}%`,
                      width: mesa.ancho ?? 70,
                      height: mesa.alto ?? 70,
                      transform: `translate(-50%, -50%) rotate(${mesa.rotacion ?? 0}deg)`,
                    }}
                  >
                    <span className="numero">{mesa.nombre}</span>
                    <span className="subtitulo">{LABEL_ESTADO_MESA[mesa.estado]}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="seccion">
            <div className="titulo-seccion">Nuevo pedido</div>
            <div className="card">
              <form onSubmit={handleSubmitPedido} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="seg">
                  {(["mesa", "barra"] as const).map((tipo) => (
                    <button
                      key={tipo}
                      type="button"
                      className={`seg-opt ${form.tipoServicio === tipo ? "active" : ""}`}
                      onClick={() => setForm({ ...form, tipoServicio: tipo as TipoServicio, mesaId: "" })}
                    >
                      {tipo === "mesa" ? "Mesa" : "Barra"}
                    </button>
                  ))}
                </div>

                {form.tipoServicio === "mesa" && (
                  <select
                    className="input"
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
                  <div key={index} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select
                      className="input"
                      value={item.platoId}
                      onChange={(e) => handleCambiarFila(index, { platoId: e.target.value })}
                      required
                    >
                      <option value="">Seleccionar plato</option>
                      {platos.map((plato) => (
                        <option key={plato.id} value={plato.id}>
                          {plato.nombre}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input"
                      style={{ maxWidth: 64 }}
                      type="number"
                      min={1}
                      value={item.cantidad}
                      onChange={(e) => handleCambiarFila(index, { cantidad: e.target.value })}
                      required
                    />
                    {form.items.length > 1 && (
                      <button type="button" className="btn btn-ghost" onClick={() => handleEliminarFila(index)}>
                        Quitar
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" className="btn btn-secondary" onClick={handleAgregarFila}>
                  Agregar línea
                </button>

                <button type="submit" className="btn btn-primary btn-block">
                  Crear pedido
                </button>
              </form>
            </div>
          </section>

          <section className="seccion">
            <div className="titulo-seccion">Mis pedidos</div>
            {pedidos.map((pedido) => (
              <div key={pedido.id} className={`tarjeta-pedido estado-${pedido.estado}`}>
                <div className="fila-superior">
                  <span className="titulo">{pedido.tipoServicio === "mesa" ? "Mesa" : "Barra"}</span>
                  <span className={`chip-estado estado-${pedido.estado}`}>{LABEL_ESTADO_PEDIDO[pedido.estado]}</span>
                </div>
                <div className="items">
                  {pedido.items.map((item) => `${item.cantidad}× ${item.nombre}`).join(" · ")}
                </div>
                {pedido.estado === "abierto" && (
                  <button type="button" className="btn btn-primary btn-block" onClick={() => handleAvanzar(pedido.id, "enviado_a_cocina")}>
                    Enviar a cocina
                  </button>
                )}
                {pedido.estado === "listo" && (
                  <button type="button" className="btn btn-sage btn-block" onClick={() => handleAvanzar(pedido.id, "entregado")}>
                    Marcar entregado
                  </button>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function mensajeDeError(err: unknown): string {
  return err instanceof Error ? err.message : "Error inesperado";
}
