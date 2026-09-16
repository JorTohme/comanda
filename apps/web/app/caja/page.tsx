"use client";

import { useEffect, useState } from "react";
import {
  abrirTurno,
  centavosToPesos,
  cerrarTurno,
  obtenerTurnoActual,
  pesosToCentavos,
  registrarMovimiento,
  type Pedido,
  type TipoMovimientoCaja,
  type TurnoCaja,
  type TurnoCajaDetalle,
} from "@comanda/shared";
import { PageHeader } from "../_components/PageHeader";
import { ErrorBanner } from "../_components/ErrorBanner";
import { Card } from "../_components/Card";
import { Button } from "../_components/Button";
import { Badge } from "../_components/Badge";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const INPUT_CLASSES =
  "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

const MOVIMIENTO_FORM_VACIO: { tipo: TipoMovimientoCaja; montoPesos: string; descripcion: string } = {
  tipo: "ingreso",
  montoPesos: "",
  descripcion: "",
};

function totalPedido(pedido: Pedido): number {
  return pedido.items.reduce((acc, item) => acc + item.precioUnitario * item.cantidad, 0);
}

export default function CajaPage() {
  const [turno, setTurno] = useState<TurnoCajaDetalle | null>(null);
  const [resultadoCierre, setResultadoCierre] = useState<TurnoCaja | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const [montoInicialPesos, setMontoInicialPesos] = useState("");
  const [movimientoForm, setMovimientoForm] = useState(MOVIMIENTO_FORM_VACIO);
  const [montoDeclaradoPesos, setMontoDeclaradoPesos] = useState("");

  useEffect(() => {
    obtenerTurnoActual(API_URL)
      .then(setTurno)
      .catch((err: unknown) => setError(mensajeDeError(err)))
      .finally(() => setCargando(false));
  }, []);

  async function handleAbrirTurno(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await abrirTurno(API_URL, { montoInicial: pesosToCentavos(montoInicialPesos) });
      const actual = await obtenerTurnoActual(API_URL);
      setTurno(actual);
      setMontoInicialPesos("");
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  async function handleRegistrarMovimiento(e: React.FormEvent) {
    e.preventDefault();
    if (!turno) return;
    setError(null);
    try {
      await registrarMovimiento(API_URL, turno.id, {
        tipo: movimientoForm.tipo,
        monto: pesosToCentavos(movimientoForm.montoPesos),
        descripcion: movimientoForm.descripcion,
      });
      const actual = await obtenerTurnoActual(API_URL);
      setTurno(actual);
      setMovimientoForm(MOVIMIENTO_FORM_VACIO);
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  async function handleCerrarTurno(e: React.FormEvent) {
    e.preventDefault();
    if (!turno) return;
    setError(null);
    try {
      const cerrado = await cerrarTurno(API_URL, turno.id, {
        montoDeclarado: pesosToCentavos(montoDeclaradoPesos),
      });
      setResultadoCierre(cerrado);
      setTurno(null);
      setMontoDeclaradoPesos("");
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  function handleAbrirNuevoTurno() {
    setResultadoCierre(null);
  }

  if (cargando) {
    return (
      <div className="space-y-8">
        <PageHeader title="Caja" description="Turnos, movimientos y cierre" />
        <p className="text-sm text-slate-500">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Caja" description="Turnos, movimientos y cierre" />

      <ErrorBanner message={error} />

      {resultadoCierre && (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Turno cerrado</h2>
          <p className="text-sm text-slate-600">Monto inicial: {centavosToPesos(resultadoCierre.montoInicial)}</p>
          <p className="text-sm text-slate-600">
            Total calculado: {centavosToPesos(resultadoCierre.totalCalculado ?? 0)}
          </p>
          <p className="text-sm text-slate-600">
            Monto declarado: {centavosToPesos(resultadoCierre.montoDeclarado ?? 0)}
          </p>
          <p className="flex items-center gap-2 text-sm text-slate-600">
            Diferencia: {centavosToPesos(resultadoCierre.diferencia ?? 0)}
            <Badge tone={(resultadoCierre.diferencia ?? 0) === 0 ? "success" : "danger"}>
              {(resultadoCierre.diferencia ?? 0) === 0 ? "Cuadrado" : "Descuadrado"}
            </Badge>
          </p>
          <Button onClick={handleAbrirNuevoTurno}>Abrir nuevo turno</Button>
        </Card>
      )}

      {!resultadoCierre && !turno && (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Abrir turno</h2>
          <form className="flex flex-wrap items-end gap-3" onSubmit={handleAbrirTurno}>
            <input
              type="number"
              step="0.01"
              min={0}
              placeholder="Monto inicial"
              value={montoInicialPesos}
              onChange={(e) => setMontoInicialPesos(e.target.value)}
              required
              className={INPUT_CLASSES}
            />
            <Button type="submit">Abrir turno</Button>
          </form>
        </Card>
      )}

      {!resultadoCierre && turno && (
        <>
          <Card className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">Turno abierto</h2>
            <p className="text-sm text-slate-600">Monto inicial: {centavosToPesos(turno.montoInicial)}</p>
            <p className="text-sm text-slate-600">Abierto en: {new Date(turno.abiertoEn).toLocaleString()}</p>
            <p className="text-lg font-semibold text-slate-900">
              Total: {centavosToPesos(turno.totalCalculado)}
            </p>
          </Card>

          <Card className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Registrar movimiento</h2>
            <form className="flex flex-wrap items-end gap-3" onSubmit={handleRegistrarMovimiento}>
              <select
                value={movimientoForm.tipo}
                onChange={(e) =>
                  setMovimientoForm({ ...movimientoForm, tipo: e.target.value as TipoMovimientoCaja })
                }
                className={INPUT_CLASSES}
              >
                <option value="ingreso">Ingreso</option>
                <option value="egreso">Egreso</option>
              </select>
              <input
                type="number"
                step="0.01"
                min={0}
                placeholder="Monto"
                value={movimientoForm.montoPesos}
                onChange={(e) => setMovimientoForm({ ...movimientoForm, montoPesos: e.target.value })}
                required
                className={INPUT_CLASSES}
              />
              <input
                type="text"
                placeholder="Descripción"
                value={movimientoForm.descripcion}
                onChange={(e) => setMovimientoForm({ ...movimientoForm, descripcion: e.target.value })}
                required
                className={INPUT_CLASSES}
              />
              <Button type="submit">Registrar movimiento</Button>
            </form>
          </Card>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Movimientos</h2>
            <div className="space-y-2">
              {turno.movimientos.map((movimiento) => (
                <Card key={movimiento.id} className="flex items-center justify-between py-3">
                  <div className="text-sm text-slate-600">
                    <Badge tone={movimiento.tipo === "ingreso" ? "success" : "danger"}>
                      {movimiento.tipo}
                    </Badge>{" "}
                    {movimiento.descripcion}
                  </div>
                  <div className="text-sm font-medium text-slate-900">
                    {centavosToPesos(movimiento.monto)}
                  </div>
                </Card>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Pedidos del turno</h2>
            <div className="space-y-2">
              {turno.pedidos.map((pedido) => (
                <Card key={pedido.id} className="flex items-center justify-between py-3">
                  <span className="text-sm capitalize text-slate-600">{pedido.tipoServicio}</span>
                  <span className="text-sm font-medium text-slate-900">
                    {centavosToPesos(totalPedido(pedido))}
                  </span>
                </Card>
              ))}
            </div>
          </section>

          <Card className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Cerrar turno</h2>
            <form className="flex flex-wrap items-end gap-3" onSubmit={handleCerrarTurno}>
              <input
                type="number"
                step="0.01"
                min={0}
                placeholder="Monto declarado"
                value={montoDeclaradoPesos}
                onChange={(e) => setMontoDeclaradoPesos(e.target.value)}
                required
                className={INPUT_CLASSES}
              />
              <Button type="submit" variant="danger">
                Cerrar turno
              </Button>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}

function mensajeDeError(err: unknown): string {
  return err instanceof Error ? err.message : "Error inesperado";
}
