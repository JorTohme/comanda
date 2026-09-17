"use client";

import { useEffect, useState } from "react";
import {
  centavosToPesos,
  obtenerReportes,
  type HoraPico,
  type PlatoRanking,
  type Reportes,
  type VentaDiaria,
} from "@comanda/shared";
import { PageHeader } from "../_components/PageHeader";
import { ErrorBanner } from "../_components/ErrorBanner";
import { Card } from "../_components/Card";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const INPUT_CLASSES =
  "rounded-full border border-hairline bg-bg px-4 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rangoPorDefecto(): { desde: string; hasta: string } {
  const hoy = new Date();
  const hace30 = new Date(hoy);
  hace30.setDate(hace30.getDate() - 30);
  return { desde: isoDate(hace30), hasta: isoDate(hoy) };
}

// Rounds only the "open" end of a bar (opposite the baseline), per the dataviz skill's
// mark spec. Right end for horizontal bars, top end for vertical bars.
function roundedRightPath(x: number, y: number, width: number, height: number, r: number): string {
  const radius = Math.max(0, Math.min(r, width, height / 2));
  if (radius === 0) return `M${x},${y} h${width} v${height} h${-width} Z`;
  return `M${x},${y} H${x + width - radius} Q${x + width},${y} ${x + width},${y + radius} V${y + height - radius} Q${x + width},${y + height} ${x + width - radius},${y + height} H${x} Z`;
}

function roundedTopPath(x: number, y: number, width: number, height: number, r: number): string {
  const radius = Math.max(0, Math.min(r, height, width / 2));
  if (radius === 0) return `M${x},${y} h${width} v${height} h${-width} Z`;
  return `M${x},${y + radius} Q${x},${y} ${x + radius},${y} H${x + width - radius} Q${x + width},${y} ${x + width},${y + radius} V${y + height} H${x} Z`;
}

function VentasChart({ data }: { data: VentaDiaria[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return <p className="text-sm text-muted">Sin datos en este rango.</p>;

  const W = 640;
  const H = 220;
  const PAD_L = 12;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 28;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const maxTotal = Math.max(...data.map((d) => d.total), 1);
  const x = (i: number) => PAD_L + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (total: number) => PAD_T + plotH - (total / maxTotal) * plotH;
  const points = data.map((d, i) => `${x(i)},${y(d.total)}`).join(" ");

  function handleMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    setHover(Math.min(data.length - 1, Math.max(0, Math.round(frac * (data.length - 1)))));
  }

  const hovered = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={PAD_L}
            x2={W - PAD_R}
            y1={PAD_T + plotH * f}
            y2={PAD_T + plotH * f}
            className="stroke-hairline"
            strokeWidth={1}
          />
        ))}
        <polyline points={points} fill="none" className="stroke-accent" strokeWidth={2} />
        <text x={PAD_L} y={H - 6} className="fill-muted text-[10px]">
          {data[0].fecha}
        </text>
        <text x={W - PAD_R} y={H - 6} textAnchor="end" className="fill-muted text-[10px]">
          {data[data.length - 1].fecha}
        </text>
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + plotH} className="stroke-hairline" strokeWidth={1} />
        )}
        <rect
          x={PAD_L}
          y={PAD_T}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={handleMove}
          onPointerLeave={() => setHover(null)}
          className="cursor-crosshair"
        />
      </svg>
      {hovered && hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs shadow-card"
          style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(hovered.total) / H) * 100}%` }}
        >
          <p className="font-medium text-ink">{centavosToPesos(hovered.total)}</p>
          <p className="text-muted">{hovered.fecha}</p>
        </div>
      )}
    </div>
  );
}

function PlatosChart({ data }: { data: PlatoRanking[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return <p className="text-sm text-muted">Sin datos en este rango.</p>;

  const W = 640;
  const ROW_H = 28;
  const GAP = 10;
  const PAD = 12;
  const LABEL_W = 180;
  const barAreaW = W - PAD * 2 - LABEL_W;
  const H = PAD * 2 + data.length * ROW_H + (data.length - 1) * GAP;
  const maxCantidad = Math.max(...data.map((d) => d.cantidad), 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {data.map((d, i) => {
        const barY = PAD + i * (ROW_H + GAP);
        const width = Math.max((d.cantidad / maxCantidad) * barAreaW, 2);
        return (
          <g key={d.platoId} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <path d={roundedRightPath(PAD, barY, width, ROW_H, 4)} className={hover === i ? "fill-accent-hover" : "fill-accent"} />
            <text x={PAD + width + 8} y={barY + ROW_H / 2 + 4} className="fill-ink text-[11px] font-medium">
              {d.nombre} · {d.cantidad}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function HorasChart({ data }: { data: HoraPico[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return <p className="text-sm text-muted">Sin datos en este rango.</p>;

  const W = 640;
  const H = 220;
  const PAD_L = 12;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 28;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const byHora = new Map(data.map((d) => [d.hora, d.pedidos]));
  const horas = Array.from({ length: 24 }, (_, h) => ({ hora: h, pedidos: byHora.get(h) ?? 0 }));
  const maxPedidos = Math.max(...horas.map((h) => h.pedidos), 1);
  const GAP = 4;
  const barW = (plotW - GAP * 23) / 24;
  const hovered = hover !== null ? horas[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
        {horas.map((h, i) => {
          const barX = PAD_L + i * (barW + GAP);
          const barH = (h.pedidos / maxPedidos) * plotH;
          const barY = PAD_T + plotH - barH;
          return (
            <g key={h.hora} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <path d={roundedTopPath(barX, barY, barW, barH, 4)} className={hover === i ? "fill-accent-hover" : "fill-accent"} />
              <rect x={barX} y={PAD_T} width={barW} height={plotH} fill="transparent" />
              {h.hora % 3 === 0 && (
                <text x={barX + barW / 2} y={H - 8} textAnchor="middle" className="fill-muted text-[10px]">
                  {h.hora}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs shadow-card"
          style={{
            left: `${((PAD_L + hover * (barW + GAP) + barW / 2) / W) * 100}%`,
            top: `${((PAD_T + plotH - (hovered.pedidos / maxPedidos) * plotH) / H) * 100}%`,
          }}
        >
          <p className="font-medium text-ink">{hovered.pedidos} pedidos</p>
          <p className="text-muted">{hovered.hora}:00</p>
        </div>
      )}
    </div>
  );
}

export default function ReportesPage() {
  const [{ desde, hasta }, setRango] = useState(rangoPorDefecto);
  const [reportes, setReportes] = useState<Reportes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    setError(null);
    obtenerReportes(API_URL, desde, hasta)
      .then(setReportes)
      .catch((err: unknown) => setError(mensajeDeError(err)))
      .finally(() => setCargando(false));
  }, [desde, hasta]);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Análisis" title="Reportes" description="Rendimiento de ventas, platos y horarios" />

      <ErrorBanner message={error} />

      <Card className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Desde
          <input
            type="date"
            value={desde}
            max={hasta}
            onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))}
            className={INPUT_CLASSES}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Hasta
          <input
            type="date"
            value={hasta}
            min={desde}
            onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))}
            className={INPUT_CLASSES}
          />
        </label>
      </Card>

      {cargando && <p className="text-sm text-muted">Cargando...</p>}

      {reportes && (
        <>
          <Card className="space-y-4">
            <h2 className="font-serif text-lg font-semibold text-ink">Rendimiento de ventas</h2>
            <VentasChart data={reportes.ventasPorDia} />
          </Card>

          <Card className="space-y-4">
            <h2 className="font-serif text-lg font-semibold text-ink">Platos más pedidos</h2>
            <PlatosChart data={reportes.platosMasPedidos} />
          </Card>

          <Card className="space-y-4">
            <h2 className="font-serif text-lg font-semibold text-ink">Horas pico</h2>
            <HorasChart data={reportes.horasPico} />
          </Card>
        </>
      )}
    </div>
  );
}

function mensajeDeError(err: unknown): string {
  return err instanceof Error ? err.message : "Error inesperado";
}
