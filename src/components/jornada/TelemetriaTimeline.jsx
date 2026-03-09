import React, { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, Zap, ZapOff, TrendingUp } from 'lucide-react';

/**
 * Converte timestamp em minutos desde meia-noite no horário local (mesmo fuso do VehicleTimeline)
 */
function toMinutes(ts) {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/**
 * Linha do tempo de telemetria sincronizada com a jornada.
 * Props:
 *  - vehicleCode: numero_frota do veículo
 *  - companyId: id da empresa
 *  - data: string "YYYY-MM-DD"
 *  - macro1Time: ISO datetime do início da jornada (Macro 1)
 *  - cursorX: número 0-100 (percentual) enviado pelo pai (sync scrubbing)
 *  - onCursorChange: callback (pct) para notificar o pai
 */
export default function TelemetriaTimeline({ vehicleCode, companyId, data, macro1Time, cursorX, onCursorChange }) {
  const [loading, setLoading] = useState(false);
  const [points, setPoints] = useState([]);
  const [distanciaKm, setDistanciaKm] = useState(null);
  const [error, setError] = useState(null);
  const [localCursor, setLocalCursor] = useState(null);
  const barRef = useRef(null);

  useEffect(() => {
    if (!vehicleCode || !data) return;
    setLoading(true);
    setError(null);
    setPoints([]);

    base44.functions.invoke('buscarTelemetria', {
      vehicleCode,
      data,
      company_id: companyId,
      macro1Time: macro1Time || null,
    }).then(res => {
      setPoints(res.data?.points || []);
      setDistanciaKm(res.data?.distanciaKm ?? null);
    }).catch(e => {
      setError(e.message || 'Erro ao buscar telemetria');
    }).finally(() => setLoading(false));
  }, [vehicleCode, data, companyId, macro1Time]);

  const handleMouseMove = useCallback((e) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    setLocalCursor(pct);
    onCursorChange?.(pct);
  }, [onCursorChange]);

  const handleMouseLeave = useCallback(() => {
    setLocalCursor(null);
    onCursorChange?.(null);
  }, [onCursorChange]);

  // Cursor efetivo: externo (sync) ou local (hover)
  const activeCursor = cursorX ?? localCursor;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 py-2 px-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        Carregando telemetria...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-red-400 py-2 px-1">Telemetria indisponível: {error}</div>
    );
  }

  if (!points.length) {
    return (
      <div className="text-xs text-slate-400 py-2 px-1">Sem dados de telemetria para este dia</div>
    );
  }

  const maxSpeed = Math.max(...points.map(p => p.speed), 1);

  // Calcular ponto correspondente ao cursor
  let cursorPoint = null;
  if (activeCursor !== null) {
    const cursorMinutes = (activeCursor / 100) * 1440;
    // Ponto mais próximo
    let closest = points[0];
    let minDiff = Infinity;
    for (const p of points) {
      const diff = Math.abs(toMinutes(p.time) - cursorMinutes);
      if (diff < minDiff) { minDiff = diff; closest = p; }
    }
    cursorPoint = closest;
  }

  return (
    <div className="select-none">
      {/* Label */}
      <div className="flex items-center justify-between mb-1 px-0.5">
        <div className="text-xs text-slate-500 flex items-center gap-1">
          <TrendingUp className="w-3 h-3" />
          Telemetria — Velocidade &amp; Ignição
        </div>
        <div className="text-xs text-slate-400">{points.length} pontos</div>
      </div>

      {/* Barra de ignição (fundo) + velocidade (altura) */}
      <div
        ref={barRef}
        className="relative h-14 bg-slate-100 rounded-lg overflow-visible border border-slate-200 cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Segmentos coloridos por estado: amarelo=parado ligado, verde=em movimento, transparente=desligado */}
        {(() => {
          const segs = [];
          for (let i = 0; i < points.length - 1; i++) {
            const p = points[i];
            const next = points[i + 1];
            const left = (toMinutes(p.time) / 1440) * 100;
            const width = ((toMinutes(next.time) - toMinutes(p.time)) / 1440) * 100;
            if (width <= 0) continue;

            let bgColor;
            if (!p.ignition) {
              bgColor = 'transparent'; // Parado - ignição desligada
            } else if (p.speed === 0) {
              bgColor = '#fef08a'; // Amarelo - parado em marcha lenta
            } else {
              bgColor = '#86efac'; // Verde - em movimento
            }

            segs.push(
              <div
                key={i}
                className="absolute top-0 h-full"
                style={{ left: `${left}%`, width: `${width}%`, backgroundColor: bgColor }}
              />
            );
          }
          return segs;
        })()}

        {/* Barras de velocidade */}
        {points.map((p, i) => {
          if (!p.ignition || p.speed === 0) return null;
          const left = (toMinutes(p.time) / 1440) * 100;
          const heightPct = (p.speed / maxSpeed) * 100;
          const next = points[i + 1];
          const barWidth = next
            ? Math.max(0.1, ((toMinutes(next.time) - toMinutes(p.time)) / 1440) * 100)
            : 0.2;

          return (
            <div
              key={i}
              className="absolute bottom-0 bg-emerald-600"
              style={{
                left: `${left}%`,
                width: `${barWidth}%`,
                height: `${heightPct}%`,
                opacity: 0.9,
              }}
            />
          );
        })}

        {/* Linha de referência de velocidade (80 km/h) */}
        {maxSpeed > 80 && (
          <div
            className="absolute w-full h-px bg-red-300 opacity-60 pointer-events-none"
            style={{ bottom: `${(80 / maxSpeed) * 100}%` }}
          >
            <span className="absolute right-1 -top-3 text-[9px] text-red-400">80 km/h</span>
          </div>
        )}

        {/* Cursor vertical sincronizado */}
        {activeCursor !== null && (
          <div
            className="absolute top-0 h-full w-0.5 bg-slate-700 opacity-80 pointer-events-none z-20"
            style={{ left: `${activeCursor}%` }}
          />
        )}

        {/* Tooltip do cursor */}
        {activeCursor !== null && cursorPoint && (
          <div
            className="absolute z-30 pointer-events-none"
            style={{
              left: `${Math.min(activeCursor, 88)}%`,
              bottom: '110%',
            }}
          >
            <div className="bg-slate-800 text-white text-[10px] rounded-lg px-2 py-1.5 shadow-lg whitespace-nowrap">
              <div className="font-semibold">
                {new Date(cursorPoint.time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <TrendingUp className="w-2.5 h-2.5 text-amber-300" />
                <span>{cursorPoint.speed} km/h</span>
              </div>
              <div className="flex items-center gap-1.5">
                {cursorPoint.ignition
                  ? <><Zap className="w-2.5 h-2.5 text-emerald-400" /><span className="text-emerald-300">Ignição ligada</span></>
                  : <><ZapOff className="w-2.5 h-2.5 text-slate-400" /><span className="text-slate-400">Ignição desligada</span></>
                }
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Legenda */}
      <div className="flex items-center gap-4 mt-1.5 text-[10px] text-slate-500 flex-wrap">
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 rounded-sm border border-slate-300 bg-white" />
          <span>Parado</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: '#fef08a', border: '1px solid #eab308' }} />
          <span>Parado - Marcha Lenta</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 rounded-sm bg-emerald-600 opacity-90" />
          <span>Em Movimento</span>
        </div>
      </div>

      {/* Distância percorrida */}
      {distanciaKm !== null && distanciaKm >= 0 && (
        <div className="mt-2 text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-100">
          {data === new Date().toISOString().split('T')[0] ? 'Hoje até o momento' : `Em ${data}`}, esse veículo/motorista deslocou-se por{' '}
          <span className="font-semibold text-slate-700">{distanciaKm} km</span>{' '}
          <span className="text-slate-400">(período entre o início da jornada até a última posição do rastreador)</span>
        </div>
      )}
    </div>
  );
}