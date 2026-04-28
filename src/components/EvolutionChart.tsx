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

  // Eje izquierdo: max(citas, ventas)
  const maxLeft = Math.max(
    ...data.map((d) => Math.max(d.citas, d.ventas)),
    1
  );
  // Eje derecho: 0-100 (conversion %)
  const maxRight = 100;

  const chartHeight = 240;
  const chartPaddingTop = 28;
  const chartPaddingBottom = 30;
  const innerHeight = chartHeight - chartPaddingTop - chartPaddingBottom;

  // Path para la línea de conversión
  const stepWidth = 100 / data.length;
  const pointXs = data.map((_, i) => stepWidth * (i + 0.5));
  const pointYs = data.map((d) => {
    const ratio = (d.conversion_pct || 0) / maxRight;
    return chartPaddingTop + innerHeight * (1 - ratio);
  });
  const linePath = pointXs
    .map((x, i) => `${i === 0 ? 'M' : 'L'} ${x} ${pointYs[i]}`)
    .join(' ');

  return (
    <div className="w-full">
      <div className="flex">
        {/* Eje Y izquierdo (citas/ventas) */}
        <div
          className="flex flex-col justify-between pr-2 text-[10px] text-muted-foreground tabular-nums"
          style={{
            height: chartHeight,
            paddingTop: chartPaddingTop - 6,
            paddingBottom: chartPaddingBottom - 6,
          }}
        >
          <span>{maxLeft}</span>
          <span>{Math.round(maxLeft * 0.75)}</span>
          <span>{Math.round(maxLeft * 0.5)}</span>
          <span>{Math.round(maxLeft * 0.25)}</span>
          <span>0</span>
        </div>

        {/* Área del gráfico */}
        <div
          className="relative flex-1 border-l border-r"
          style={{ height: chartHeight }}
        >
          {/* Líneas guía horizontales */}
          {[0.25, 0.5, 0.75].map((p) => (
            <div
              key={p}
              className="absolute left-0 right-0 border-t border-dashed border-slate-100"
              style={{ top: chartPaddingTop + innerHeight * (1 - p) }}
            />
          ))}

          {/* SVG para línea de conversión (eje derecho) */}
          <svg
            viewBox={`0 0 100 ${chartHeight}`}
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            {/* Líneas auxiliares de conversión (cada 25%) */}
            {[25, 50, 75].map((v) => {
              const y = chartPaddingTop + innerHeight * (1 - v / 100);
              return (
                <line
                  key={v}
                  x1="0"
                  x2="100"
                  y1={y}
                  y2={y}
                  className="stroke-slate-100"
                  strokeWidth="0.2"
                />
              );
            })}
            {/* Línea de conversión */}
            <path
              d={linePath}
              fill="none"
              className="stroke-sky-500 transition-all duration-300"
              strokeWidth="0.6"
              vectorEffect="non-scaling-stroke"
              style={{ strokeWidth: 2 }}
            />
            {/* Puntos sobre la línea */}
            {pointXs.map((x, i) => (
              <circle
                key={i}
                cx={x}
                cy={pointYs[i]}
                r="0.8"
                className="fill-sky-500"
                vectorEffect="non-scaling-stroke"
                style={{ r: 4 }}
              />
            ))}
          </svg>

          {/* Barras */}
          <div className="absolute inset-0 flex items-end px-1">
            {data.map((d, i) => {
              const hC = (d.citas / maxLeft) * innerHeight;
              const hV = (d.ventas / maxLeft) * innerHeight;
              const isHover = hovered === i;
              return (
                <div
                  key={d.mes}
                  className="flex-1 flex flex-col items-center justify-end gap-0 min-w-0 relative px-0.5"
                  style={{ height: chartHeight }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                >
                  {/* Tooltip */}
                  {isHover && (
                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full z-10 bg-slate-900 text-white text-[11px] rounded-md px-2.5 py-1.5 shadow-lg whitespace-nowrap pointer-events-none">
                      <div className="font-semibold capitalize mb-1">{mesLabel(d.mes)}</div>
                      <div className="space-y-0.5">
                        <div className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-sm bg-amber-400 inline-block" />
                          Citas: <strong>{d.citas}</strong>
                        </div>
                        <div className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-sm bg-ymc-red inline-block" />
                          Ventas: <strong>{d.ventas}</strong>
                        </div>
                        <div className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-sm bg-sky-500 inline-block" />
                          Conv.: <strong>{d.conversion_pct.toFixed(1)}%</strong>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-end justify-center gap-0.5 w-full"
                       style={{ height: innerHeight, marginBottom: chartPaddingBottom }}>
                    {/* Barra citas (amber) */}
                    <div
                      className={`w-full max-w-[18px] bg-amber-400 rounded-t transition-all duration-300 ease-out relative ${
                        isHover ? 'opacity-100 ring-2 ring-amber-300' : 'opacity-90 hover:opacity-100'
                      }`}
                      style={{ height: hC || 1 }}
                      title={`Citas: ${d.citas}`}
                    >
                      {(isHover || data.length <= 6) && d.citas > 0 && (
                        <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] font-semibold text-amber-700">
                          {d.citas}
                        </span>
                      )}
                    </div>
                    {/* Barra ventas (red) */}
                    <div
                      className={`w-full max-w-[18px] bg-ymc-red rounded-t transition-all duration-300 ease-out relative ${
                        isHover ? 'opacity-100 ring-2 ring-ymc-red/30' : 'opacity-90 hover:opacity-100'
                      }`}
                      style={{ height: hV || 1 }}
                      title={`Ventas: ${d.ventas}`}
                    >
                      {(isHover || data.length <= 6) && d.ventas > 0 && (
                        <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] font-semibold text-ymc-red">
                          {d.ventas}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Etiqueta del mes */}
                  <span
                    className={`absolute bottom-1 left-0 right-0 text-center text-[10px] capitalize ${
                      isHover ? 'text-foreground font-medium' : 'text-muted-foreground'
                    }`}
                  >
                    {mesLabel(d.mes)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Eje Y derecho (conversion %) */}
        <div
          className="flex flex-col justify-between pl-2 text-[10px] text-sky-600 tabular-nums"
          style={{
            height: chartHeight,
            paddingTop: chartPaddingTop - 6,
            paddingBottom: chartPaddingBottom - 6,
          }}
        >
          <span>100%</span>
          <span>75%</span>
          <span>50%</span>
          <span>25%</span>
          <span>0%</span>
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex items-center justify-center gap-5 text-xs mt-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-3 bg-amber-400 rounded-sm" /> Citas
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-3 bg-ymc-red rounded-sm" /> Ventas
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="20" height="6">
            <line x1="0" y1="3" x2="20" y2="3" className="stroke-sky-500" strokeWidth="2" />
            <circle cx="10" cy="3" r="2" className="fill-sky-500" />
          </svg>
          % Conversión
        </span>
      </div>
    </div>
  );
}
