import { useEffect, useState } from "react";
import { avanzarEstadoPedido, listPedidos, listPlatos, updatePlato, type AuthSession, type Pedido, type Plato } from "@comanda/shared";
import { ErrorBanner } from "./_components/ErrorBanner";
import { API_URL } from "./config";

export function CocinaView({ session, onLogout }: { session: AuthSession; onLogout: () => void }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [platos, setPlatos] = useState<Plato[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  function cargarDatos() {
    return Promise.all([listPedidos(API_URL), listPlatos(API_URL)])
      .then(([pedidosRes, platosRes]) => {
        setPedidos(pedidosRes);
        setPlatos(platosRes);
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

  async function handleAvanzar(pedidoId: string, estado: "en_preparacion" | "listo") {
    setError(null);
    try {
      await avanzarEstadoPedido(API_URL, pedidoId, estado);
      recargarPedidos();
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  async function handleToggleDisponible(plato: Plato) {
    setError(null);
    const anterior = plato.disponible;
    setPlatos(platos.map((p) => (p.id === plato.id ? { ...p, disponible: !anterior } : p)));
    try {
      await updatePlato(API_URL, plato.id, { disponible: !anterior });
    } catch (err) {
      setPlatos((current) => current.map((p) => (p.id === plato.id ? { ...p, disponible: anterior } : p)));
      setError(mensajeDeError(err));
    }
  }

  const nuevos = pedidos.filter((p) => p.estado === "enviado_a_cocina");
  const enPreparacion = pedidos.filter((p) => p.estado === "en_preparacion");
  const listos = pedidos.filter((p) => p.estado === "listo");

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
            <h2>Nuevos</h2>
            <ul>
              {nuevos.map((pedido) => (
                <li key={pedido.id}>
                  <PedidoResumen pedido={pedido} />
                  <button type="button" onClick={() => handleAvanzar(pedido.id, "en_preparacion")}>
                    Empezar
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>En preparación</h2>
            <ul>
              {enPreparacion.map((pedido) => (
                <li key={pedido.id}>
                  <PedidoResumen pedido={pedido} />
                  <button type="button" onClick={() => handleAvanzar(pedido.id, "listo")}>
                    Listo
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Listos (esperando retiro)</h2>
            <ul>
              {listos.map((pedido) => (
                <li key={pedido.id}>
                  <PedidoResumen pedido={pedido} />
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Disponibilidad de platos</h2>
            <ul>
              {platos.map((plato) => (
                <li key={plato.id}>
                  <label>
                    <input type="checkbox" checked={plato.disponible} onChange={() => handleToggleDisponible(plato)} />
                    {plato.nombre}
                  </label>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function PedidoResumen({ pedido }: { pedido: Pedido }) {
  return (
    <div>
      <span>{pedido.tipoServicio === "mesa" ? `Mesa` : "Barra"}</span>
      <ul>
        {pedido.items.map((item) => (
          <li key={item.id}>
            {item.nombre} × {item.cantidad}
          </li>
        ))}
      </ul>
    </div>
  );
}

function mensajeDeError(err: unknown): string {
  return err instanceof Error ? err.message : "Error inesperado";
}
