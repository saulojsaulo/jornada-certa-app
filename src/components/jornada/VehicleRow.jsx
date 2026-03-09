import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Utensils, Moon, AlertTriangle } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import {
  STATUS_CONFIG,
  minutesToHHMM,
  getVehicleStatus,
  calcularJornadaLiquida,
  calcularTempoDisponivel,
  calcularHorasExtras,
  calcularInterjornada,
  verificarAlertaRefeicao,
  verificarAlertasInterjornada
} from './MacroUtils';
import { extractFleetNumber, getDriverName, getManagerName } from './DriverData';

// Função auxiliar para obter o nome do motorista (prioriza cadastro, depois fallback)
function getMotoristaDisplay(veiculo) {
  if (veiculo.motorista?.nome) {
    return veiculo.motorista.nome;
  }
  return getDriverName(veiculo.nome_veiculo);
}

// Função auxiliar para obter o nome do gestor (prioriza cadastro, depois fallback)
function getGestorDisplay(veiculo) {
  if (veiculo.gestor?.nome) {
    return veiculo.gestor.nome;
  }
  return getManagerName(veiculo.nome_veiculo);
}
import VehicleTimeline from './VehicleTimeline';

function formatDataHora(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d)) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo'
  });
}

const DEFAULT_WIDTHS = {
  gestor: 90, frota: 60, motorista: 150, status: 100,
  ultimaPosicao: 170, dataHoraPosicao: 120, jornada: 65, disponivel: 70, hextra: 65, alertas: 70
};

export default function VehicleRow({ veiculo, macrosHoje, macrosOntem, todasMacros, ultimaPosicao, colWidths, selectedDate }) {
  const widths = colWidths || DEFAULT_WIDTHS;
  const [expanded, setExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Atualizar a cada minuto
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const status = getVehicleStatus(macrosHoje);
  const statusConfig = STATUS_CONFIG[status] || STATUS_CONFIG['Sem Jornada'];
  
  const jornadaLiquida = calcularJornadaLiquida(macrosHoje);
  const tempoDisponivel = calcularTempoDisponivel(macrosHoje);
  const horasExtras = calcularHorasExtras(macrosHoje);
  const interjornada = calcularInterjornada(macrosHoje, macrosOntem);
  
  const alertaRefeicao = verificarAlertaRefeicao(macrosHoje);
  const alertasInterjornada = verificarAlertasInterjornada(interjornada, macrosHoje);

  return (
    <motion.div
      layout
      className={`rounded-xl overflow-hidden shadow-md border-2 ${expanded ? 'border-slate-400' : 'border-slate-200'} ${statusConfig.rowColor}`}
    >
      <div
        className="p-1 cursor-pointer hover:bg-white/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="grid grid-cols-1 md:gap-1 items-center" style={{ gridTemplateColumns: Object.entries(widths).map(([, w]) => `${w}px`).join(' ') }}>
          {/* Gestor */}
          <div className="col-span-1">
            <div className="md:hidden text-xs text-slate-500 mb-1">Gestor</div>
            <span className="text-sm font-medium text-slate-700">{getGestorDisplay(veiculo)}</span>
          </div>

          {/* Frota */}
          <div className="col-span-1">
            <div className="md:hidden text-xs text-slate-500 mb-1">Frota</div>
            <span className="font-bold text-slate-800 text-base">{extractFleetNumber(veiculo.nome_veiculo)}</span>
          </div>

          {/* Motorista */}
          <div className="col-span-1 overflow-hidden">
            <div className="md:hidden text-xs text-slate-500 mb-1">Motorista</div>
            <span className="text-xs text-slate-700 truncate block whitespace-nowrap overflow-hidden">
              {getMotoristaDisplay(veiculo)}
            </span>
          </div>

          {/* Status */}
          <div className="col-span-1 overflow-hidden">
            <div className="md:hidden text-xs text-slate-500 mb-1">Status</div>
            <Badge className={`${statusConfig.color} font-medium text-[10px] whitespace-nowrap px-1.5 py-0.5`}>
              {status}
            </Badge>
          </div>

          {/* Última Posição */}
          <div className="col-span-1 overflow-hidden">
            <div className="md:hidden text-xs text-slate-500 mb-1">Última Posição</div>
            <span className="text-xs text-slate-600 truncate block whitespace-nowrap overflow-hidden" title={ultimaPosicao?.address || ''}>
              {ultimaPosicao?.address || <span className="text-slate-300">—</span>}
            </span>
          </div>

          {/* Data/Hora */}
          <div className="col-span-1 overflow-hidden">
            <div className="md:hidden text-xs text-slate-500 mb-1">Data/Hora</div>
            <span className="text-xs text-slate-500 whitespace-nowrap block overflow-hidden">
              {formatDataHora(ultimaPosicao?.time)}
            </span>
          </div>

          {/* Jornada em Tempo Real */}
          <div className="flex items-center justify-center overflow-hidden">
            <div className={`font-sans font-bold text-sm whitespace-nowrap ${jornadaLiquida > 480 ? 'text-amber-600' : 'text-slate-700'}`}>
              {minutesToHHMM(jornadaLiquida)}
            </div>
          </div>

          {/* Tempo Disponível */}
          <div className="flex items-center justify-center overflow-hidden">
            <div className={`font-sans font-bold text-sm whitespace-nowrap ${tempoDisponivel < 60 ? 'text-red-600' : 'text-emerald-600'}`}>
              {minutesToHHMM(tempoDisponivel)}
            </div>
          </div>

          {/* Horas Extras */}
          <div className="flex items-center justify-center overflow-hidden">
            <div className={`font-sans font-bold text-sm whitespace-nowrap ${horasExtras > 0 ? 'text-red-600' : 'text-slate-400'}`}>
              {minutesToHHMM(horasExtras)}
            </div>
          </div>

          {/* Alertas */}
          <div className="flex items-center justify-end gap-1 overflow-hidden">
            {alertaRefeicao && (
              <span title="Alerta Refeição" className="text-base leading-none">🍽️</span>
            )}
            {alertasInterjornada.alerta11h && !alertasInterjornada.alerta8h && (
              <span title="Interjornada < 11h" className="text-base leading-none">🌙</span>
            )}
            {alertasInterjornada.alerta8h && (
              <span title="Interjornada < 8h" className="text-base leading-none">💣</span>
            )}
            {!alertaRefeicao && !alertasInterjornada.alerta11h && !alertasInterjornada.alerta8h && (
              <span className="text-slate-300 text-xs">—</span>
            )}
          </div>
        </div>
      </div>

      {/* Timeline expandida */}
      <AnimatePresence>
        {expanded && (
            <VehicleTimeline 
              macros={macrosHoje} 
              todasMacrosVeiculo={todasMacros}
              dataReferencia={macrosHoje[0]?.data_jornada}
              vehicleCode={veiculo.numero_frota}
              companyId={veiculo.company_id}
            />
          )}
      </AnimatePresence>
    </motion.div>
  );
}