'use client';

import { useState } from 'react';

const MES_LABEL = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];
function mesLabel(yyyymm: string) {
  const [y, m] = yyyymm.split('-');
  return `${MES_LABEL[Number(m) - 1]} ${y.slice(2)}`;
}

export type MonthRow = {
  mes: string;
  citas: number;
  atendidas: number;
  no_show: number;
  ventas: number;
  margen_eur: number;
  margen_medio_eur: number;
  conversion_pct: number;
};

export default function EvolutionChart({ data }: { data: MonthRow[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">Sin datos.</p>;
  }

  // Escalas separadas: izq = citas; der = ventas y % conversión (compartido visual)
  const maxCitas = Math.max(...data.map((d) => d.citas), 1);
  const maxVentas = Math.max(...data.map((d) => d.ventas), 1);
  const niceMax = (n: number) => {
    // Redondea a un múltiplo razonable para los ticks del eje
    if (n <= 5) return 5;
    if (n <= 10) return 10;
    if (n <= 20) return 20;
    if (n <= 50) return 50;
    if (n <= 100) return 100;
    return Math.ceil(n / 50) * 50;
  };
  const yLeftMax = niceMax(maxCitas);
  const yRightMax = niceMax(maxVentas);

  // Dimensiones del SVG (viewBox)
  const W = 1000;
  const H = 380;
  const PAD_L = 70;
  const PAD_R = 70;
  const PAD_T = 50;
  const PAD_B = 60;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const slot = innerW / data.length;
  const barW = Math.min(36, slot / 3.2);
  const gap = barW * 0.35;

  // Helpers de proyección
  const yFromLeft = (v: number) => PAD_T + innerH * (1 - v / yLeftMax);
  const yFromRight = (v: number) => PAD_T + innerH * (1 - v / yRightMax);
  const yFromConv = (v: number) => PAD_T + innerH * (1 - Math.min(100, v) / 100);

  // Línea de conversión
  const convPoints = data.map((d, i) => ({
    x: PAD_L + slot * (i + 0.5),
    y: yFromConv(d.conversion_pct || 0),
    v: d.conversion_pct || 0,
  }));
  const convPath = convPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  // Ticks del eje izquierdo (citas)
  const leftTicks = [0, 0.25, 0.5, 0.75, 1].map((p) => ({
    y: PAD_T + innerH * (1 - p),
    label: Math.round(yLeftMax * p),
  }));
  // Ticks del eje derecho (ventas + conversión%)
  const rightTicks = [0, 0.25, 0.5, 0.75, 1].map((p) => ({
    y: PAD_T + innerH * (1 - p),
    ventasLabel: Math.round(yRightMax * p),
    convLabel: Math.round(100 * p),
  }));

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ minHeight: 320 }}>
        {/* Grid horizontal */}
        {leftTicks.map((t, i) => (
          <line
            key={i}
            x1={PAD_L}
            x2={W - PAD_R}
            y1={t.y}
            y2={t.y}
            className="stroke-slate-200"
            strokeWidth="1"
            strokeDasharray={i === 0 ? '0' : '3 3'}
          />
        ))}

        {/* Eje X */}
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={H - PAD_B}
          y2={H - PAD_B}
          className="stroke-slate-400"
          strokeWidth="1.5"
        />
        {/* Eje Y izquierdo */}
        <line
          x1={PAD_L}
          x2={PAD_L}
          y1={PAD_T}
          y2={H - PAD_B}
          className="stroke-slate-400"
          strokeWidth="1.5"
        />
        {/* Eje Y derecho */}
        <line
          x1={W - PAD_R}
          x2={W - PAD_R}
          y1={PAD_T}
          y2={H - PAD_B}
          className="stroke-slate-400"
          strokeWidth="1.5"
        />

        {/* Etiquetas eje izq (citas) */}
        {leftTicks.map((t, i) => (
          <g key={`left-${i}`}>
            <line
              x1={PAD_L - 6}
              x2={PAD_L}
              y1={t.y}
              y2={t.y}
              className="stroke-slate-400"
              strokeWidth="1.5"
            />
            <text
              x={PAD_L - 10}
              y={t.y + 5}
              textAnchor="end"
              className="fill-slate-700"
              fontSize="14"
              fontWeight="500"
            >
              {t.label}
            </text>
          </g>
        ))}
        {/* Etiquetas eje der (ventas + %) */}
        {rightTicks.map((t, i) => (
          <g key={`right-${i}`}>
            <line
              x1={W - PAD_R}
              x2={W - PAD_R + 6}
              y1={t.y}
              y2={t.y}
              className="stroke-slate-400"
              strokeWidth="1.5"
            />
            <text
              x={W - PAD_R + 10}
              y={t.y + 5}
              textAnchor="start"
              className="fill-ymc-red"
              fontSize="13"
              fontWeight="600"
            >
              {t.ventasLabel}
            </text>
            <text
              x={W - PAD_R + 10}
              y={t.y + 20}
              textAnchor="start"
              className="fill-sky-600"
              fontSize="11"
              fontWeight="500"
            >
              {t.convLabel}%
            </text>
          </g>
        ))}

        {/* Títulos de los ejes */}
        <text
          x={PAD_L - 50}
          y={PAD_T - 18}
          className="fill-amber-600 font-semibold"
          fontSize="13"
          textAnchor="start"
        >
          Citas
        </text>
        <text
          x={W - PAD_R + 10}
          y={PAD_T - 18}
          className="fill-ymc-red font-semibold"
          fontSize="13"
        >
          Ventas
        </text>
        <text
          x={W - PAD_R + 10}
          y={PAD_T - 4}
          className="fill-sky-600 font-semibold"
          fontSize="11"
        >
          % Conversión
        </text>

        {/* Barras + etiquetas X */}
        {data.map((d, i) => {
          const cx = PAD_L + slot * (i + 0.5);
          const xCitas = cx - barW - gap / 2;
          const xVentas = cx + gap / 2;
          const yCitas = yFromLeft(d.citas);
          const yVentas = yFromRight(d.ventas);
          const isHover = hovered === i;
          return (
            <g
              key={d.mes}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer' }}
            >
              {/* Hit area */}
              <rect
                x={PAD_L + slot * i}
                y={PAD_T}
                width={slot}
                height={innerH}
                fill="transparent"
              />

              {/* Highlight columna en hover */}
              {isHover && (
                <rect
                  x={PAD_L + slot * i}
                  y={PAD_T}
                  width={slot}
                  height={innerH}
                  className="fill-ymc-redLight"
                  opacity="0.5"
                />
              )}

              {/* Barra citas (izq, amber) */}
              <rect
                x={xCitas}
                y={yCitas}
                width={barW}
                height={H - PAD_B - yCitas}
                rx="3"
                className={`fill-amber-400 transition-all duration-200 ${
                  isHover ? 'fill-amber-500' : ''
                }`}
              />
              {d.citas > 0 && (
                <text
                  x={xCitas + barW / 2}
                  y={yCitas - 6}
                  textAnchor="middle"
                  className="fill-amber-700 font-semibold"
                  fontSize="13"
                >
                  {d.citas}
                </text>
              )}

              {/* Barra ventas (der, red) */}
              <rect
                x={xVentas}
                y={yVentas}
                width={barW}
                height={H - PAD_B - yVentas}
                rx="3"
                className={`fill-ymc-red transition-all duration-200 ${
                  isHover ? 'opacity-100' : 'opacity-90'
                }`}
              />
              {d.ventas > 0 && (
                <text
                  x={xVentas + barW / 2}
                  y={yVentas - 6}
                  textAnchor="middle"
                  className="fill-ymc-red font-semibold"
                  fontSize="13"
                >
                  {d.ventas}
                </text>
              )}

              {/* Etiqueta del mes */}
              <text
                x={cx}
                y={H - PAD_B + 24}
                textAnchor="middle"
                className={`capitalize ${
                  isHover ? 'fill-foreground font-semibold' : 'fill-slate-600'
                }`}
                fontSize="14"
              >
                {mesLabel(d.mes)}
              </text>
            </g>
          );
        })}

        {/* Línea conversión (encima de las barras) */}
        <path
          d={convPath}
          fill="none"
          className="stroke-sky-500"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Puntos + etiquetas conversión */}
        {convPoints.map((p, i) => (
          <g key={`pt-${i}`}>
            <circle
              cx={p.x}
              cy={p.y}
              r={hovered === i ? 7 : 5}
              className="fill-white stroke-sky-500 transition-all duration-200"
              strokeWidth="3"
            />
            {p.v > 0 && (
              <text
                x={p.x}
                y={p.y - 12}
                textAnchor="middle"
                className="fill-sky-700 font-semibold"
                fontSize="12"
              >
                {p.v.toFixed(0)}%
              </text>
            )}
          </g>
        ))}

        {/* Tooltip al hover */}
        {hovered !== null && (() => {
          const d = data[hovered];
          const cx = PAD_L + slot * (hovered + 0.5);
          const tooltipW = 180;
          const tooltipH = 100;
          const tx = Math.min(W - PAD_R - tooltipW, Math.max(PAD_L, cx - tooltipW / 2));
          const ty = PAD_T + 8;
          return (
            <g pointerEvents="none">
              <rect
                x={tx}
                y={ty}
                width={tooltipW}
                height={tooltipH}
                rx="6"
                className="fill-slate-900"
                opacity="0.95"
              />
              <text x={tx + 12} y={ty + 22} className="fill-white font-bold capitalize" fontSize="14">
                {mesLabel(d.mes)}
              </text>
              <circle cx={tx + 14} cy={ty + 42} r="4" className="fill-amber-400" />
              <text x={tx + 24} y={ty + 46} className="fill-white" fontSize="13">
                Citas: <tspan fontWeight="bold">{d.citas}</tspan>
              </text>
              <circle cx={tx + 14} cy={ty + 62} r="4" className="fill-ymc-red" />
              <text x={tx + 24} y={ty + 66} className="fill-white" fontSize="13">
                Ventas: <tspan fontWeight="bold">{d.ventas}</tspan>
              </text>
              <circle cx={tx + 14} cy={ty + 82} r="4" className="fill-sky-400" />
              <text x={tx + 24} y={ty + 86} className="fill-white" fontSize="13">
                Conv.: <tspan fontWeight="bold">{d.conversion_pct.toFixed(1)}%</tspan>
              </text>
            </g>
          );
        })()}
      </svg>

      {/* Leyenda inferior */}
      <div className="flex items-center justify-center gap-6 text-sm mt-2">
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-4 bg-amber-400 rounded-sm" />
          <span className="text-slate-700 font-medium">Citas</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-4 bg-ymc-red rounded-sm" />
          <span className="text-slate-700 font-medium">Ventas</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width="24" height="10">
            <line
              x1="0"
              y1="5"
              x2="24"
              y2="5"
              className="stroke-sky-500"
              strokeWidth="3"
            />
            <circle cx="12" cy="5" r="3" className="fill-white stroke-sky-500" strokeWidth="2" />
          </svg>
          <span className="text-slate-700 font-medium">% Conversión</span>
        </span>
      </div>
    </div>
  );
}
