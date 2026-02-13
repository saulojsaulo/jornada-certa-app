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

export default function VehicleRow({ veiculo, macrosHoje, macrosOntem, todasMacros }) {
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
        <div className="grid grid-cols-1 md:grid-cols-12 gap-1 items-center">
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
          <div className="col-span-3">
            <div className="md:hidden text-xs text-slate-500 mb-1">Motorista</div>
            <span className="text-sm text-slate-700 block">
              {getMotoristaDisplay(veiculo)}
            </span>
          </div>

          {/* Status */}
          <div className="col-span-2">
            <div className="md:hidden text-xs text-slate-500 mb-1">Status</div>
            <Badge className={`${statusConfig.color} font-medium text-xs`}>
              {status}
            </Badge>
          </div>

          {/* Jornada em Tempo Real */}
          <div className="col-span-1 text-center">
            <div className="text-xs text-slate-500 mb-1 md:hidden">Jornada</div>
            <div className={`font-sans font-bold text-sm ${jornadaLiquida > 480 ? 'text-amber-600' : 'text-slate-700'}`}>
              {minutesToHHMM(jornadaLiquida)}
            </div>
          </div>

          {/* Tempo Disponível */}
          <div className="col-span-1 text-center">
            <div className="text-xs text-slate-500 mb-1 md:hidden">Disponível</div>
            <div className={`font-sans font-bold text-sm ${tempoDisponivel < 60 ? 'text-red-600' : 'text-emerald-600'}`}>
              {minutesToHHMM(tempoDisponivel)}
            </div>
          </div>

          {/* Horas Extras */}
          <div className="col-span-1 text-center">
            <div className="text-xs text-slate-500 mb-1 md:hidden">H. Extra</div>
            <div className={`font-sans font-bold text-sm ${horasExtras > 0 ? 'text-red-600' : 'text-slate-400'}`}>
              {minutesToHHMM(horasExtras)}
            </div>
          </div>

          {/* Total do Dia */}
          <div className="col-span-1 text-center">
            <div className="text-xs text-slate-500 mb-1 md:hidden">Total</div>
            <div className="font-sans font-bold text-sm text-slate-700">
              {minutesToHHMM(jornadaLiquida)}
            </div>
          </div>

          {/* Alertas */}
          <div className="col-span-1 flex items-center justify-end gap-2">
            {/* Alerta Refeição */}
            {alertaRefeicao && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="flex items-center gap-1 bg-amber-100 text-amber-700 px-2 py-1 rounded-full text-xs font-medium"
              >
                🍽️
              </motion.div>
            )}

            {/* Alerta Interjornada < 11h */}
            {alertasInterjornada.alerta11h && !alertasInterjornada.alerta8h && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="flex items-center gap-1 bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full text-xs font-medium"
              >
                🌙
              </motion.div>
            )}

            {/* Alerta Interjornada < 8h */}
            {alertasInterjornada.alerta8h && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="flex items-center gap-1 bg-red-100 text-red-700 px-2 py-1 rounded-full text-xs font-medium"
              >
                💣
              </motion.div>
            )}

            {/* Sem alertas */}
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
            />
          )}
      </AnimatePresence>
    </motion.div>
  );
}