import { useEffect, useState } from "react";
import { avanzarEstadoPedido, connectRealtime, listPedidos, listPlatos, updatePlato, type AuthSession, type Pedido, type Plato } from "@comanda/shared";
import { ErrorBanner } from "./_components/ErrorBanner";
import { API_URL } from "./config";
import { getDb } from "./db/schema";
import { useRxData } from "./db/useRxData";

export function CocinaView({ session, onLogout }: { session: AuthSession; onLogout: () => void }) {
  const pedidos = useRxData<Pedido>("pedidos");
  const platos = useRxData<Plato>("platos");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  function cargarDatos() {
    return Promise.all([listPedidos(API_URL), listPlatos(API_URL)])
      .then(async ([pedidosRes, platosRes]) => {
        const db = await getDb();
        await Promise.all([
          ...pedidosRes.map((pedido) => db.collections.pedidos.upsert(pedido)),
          ...platosRes.map((plato) => db.collections.platos.upsert(plato)),
        ]);
      })
      .catch((err: unknown) => setError(mensajeDeError(err)));
  }

  useEffect(() => {
    cargarDatos().finally(() => setCargando(false));

    const socket = connectRealtime(API_URL, session.accessToken);
    socket.on("pedido.actualizado", async (pedido: Pedido) => {
      const db = await getDb();
      await db.collections.pedidos.upsert(pedido);
    });
    socket.on("plato.actualizado", async (plato: Plato) => {
      const db = await getDb();
      await db.collections.platos.upsert(plato);
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  async function handleAvanzar(pedidoId: string, estado: "en_preparacion" | "listo") {
    setError(null);
    try {
      const actualizado = await avanzarEstadoPedido(API_URL, pedidoId, estado);
      const db = await getDb();
      await db.collections.pedidos.upsert(actualizado);
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  async function handleToggleDisponible(plato: Plato) {
    setError(null);
    const db = await getDb();
    await db.collections.platos.upsert({ ...plato, disponible: !plato.disponible });
    try {
      const actualizado = await updatePlato(API_URL, plato.id, { disponible: !plato.disponible });
      await db.collections.platos.upsert(actualizado);
    } catch (err) {
      await db.collections.platos.upsert(plato);
      setError(mensajeDeError(err));
    }
  }

  const nuevos = pedidos.filter((p) => p.estado === "enviado_a_cocina");
  const enPreparacion = pedidos.filter((p) => p.estado === "en_preparacion");
  const listos = pedidos.filter((p) => p.estado === "listo");

  return (
    <div className="pantalla kds-pantalla">
      <header className="kds-barra-superior">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <h1>Cocina</h1>
          <span className="tag" style={{ background: "var(--color-accent)", color: "var(--color-bg)" }}>
            {pedidos.filter((p) => p.estado !== "entregado" && p.estado !== "cerrado" && p.estado !== "cobrado").length} EN CURSO
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span className="text-muted">Hola, {session.user.nombre}</span>
          <button type="button" className="btn btn-ghost" onClick={onLogout}>
            Cerrar sesión
          </button>
        </div>
      </header>

      <ErrorBanner message={error} />

      {cargando ? (
        <p className="text-muted">Cargando...</p>
      ) : (
        <>
          <div className="kds-tablero">
            <div>
              <div className="kds-columna-titulo">
                <span className="kds-contador" style={{ background: "var(--state-cocina)" }}>{nuevos.length}</span>
                Nuevos
              </div>
              {nuevos.map((pedido) => (
                <div key={pedido.id} className="ticket col-nuevos">
                  <PedidoResumen pedido={pedido} />
                  <button type="button" className="btn btn-block" style={{ background: "var(--state-cocina)", color: "var(--state-cocina-ink)", marginTop: 8 }} onClick={() => handleAvanzar(pedido.id, "en_preparacion")}>
                    Empezar
                  </button>
                </div>
              ))}
            </div>

            <div>
              <div className="kds-columna-titulo">
                <span className="kds-contador" style={{ background: "var(--state-prep)" }}>{enPreparacion.length}</span>
                En preparación
              </div>
              {enPreparacion.map((pedido) => (
                <div key={pedido.id} className="ticket col-preparacion">
                  <PedidoResumen pedido={pedido} />
                  <button type="button" className="btn btn-sage btn-block" style={{ marginTop: 8 }} onClick={() => handleAvanzar(pedido.id, "listo")}>
                    Marcar listo
                  </button>
                </div>
              ))}
            </div>

            <div>
              <div className="kds-columna-titulo">
                <span className="kds-contador" style={{ background: "var(--state-listo)" }}>{listos.length}</span>
                Listos · esperando retiro
              </div>
              {listos.map((pedido) => (
                <div key={pedido.id} className="ticket col-listos">
                  <PedidoResumen pedido={pedido} />
                </div>
              ))}
            </div>
          </div>

          <div className="panel-disponibilidad">
            <div className="titulo-seccion">Disponibilidad de platos</div>
            {platos.map((plato) => (
              <button
                key={plato.id}
                type="button"
                className={`toggle-plato ${plato.disponible ? "" : "off"}`}
                onClick={() => handleToggleDisponible(plato)}
              >
                <span className={`switch ${plato.disponible ? "on" : ""}`} />
                {plato.nombre}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PedidoResumen({ pedido }: { pedido: Pedido }) {
  return (
    <div>
      <div className="fila-superior">
        <span className="mesa-nombre">{pedido.tipoServicio === "mesa" ? "Mesa" : "Barra"}</span>
      </div>
      <ul className="items">
        {pedido.items.map((item) => (
          <li key={item.id}>
            <span className="cant">{item.cantidad}×</span> {item.nombre}
          </li>
        ))}
      </ul>
    </div>
  );
}

function mensajeDeError(err: unknown): string {
  return err instanceof Error ? err.message : "Error inesperado";
}
