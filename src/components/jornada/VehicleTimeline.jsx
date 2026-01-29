import React from 'react';
import { motion } from 'framer-motion';
import { 
  MACRO_NAMES, 
  minutesToHHMM,
  calcularJornadaBruta,
  calcularJornadaLiquida,
  calcularPausas,
  calcularHorasExtras,
  STATUS_CONFIG
} from './MacroUtils';
import { Clock, Coffee, Moon, Zap, Play, Square } from 'lucide-react';

export default function VehicleTimeline({ macros }) {
  if (!macros || macros.length === 0) {
    return (
      <div className="p-6 text-center text-slate-400">
        Nenhum evento registrado hoje
      </div>
    );
  }

  const sorted = [...macros].sort((a, b) => new Date(a.data_criacao) - new Date(b.data_criacao));
  
  const jornadaBruta = calcularJornadaBruta(macros);
  const jornadaLiquida = calcularJornadaLiquida(macros);
  const pausas = calcularPausas(macros);
  const horasExtras = calcularHorasExtras(macros);
  
  const limite12h = 720;
  const limite8h = 480;
  
  // Calcular porcentagens para barras de progresso
  const maxMinutes = Math.max(limite12h, jornadaBruta);
  const jornadaPercent = Math.min(100, (jornadaLiquida / maxMinutes) * 100);
  const pausaPercent = (pausas.total / maxMinutes) * 100;
  const limitePercent = (limite12h / maxMinutes) * 100;
  const limite8hPercent = (limite8h / maxMinutes) * 100;

  const getMacroIcon = (num) => {
    switch(num) {
      case 1: return <Play className="w-3 h-3" />;
      case 2: return <Square className="w-3 h-3" />;
      case 3: case 4: return <Coffee className="w-3 h-3" />;
      case 5: case 6: return <Moon className="w-3 h-3" />;
      case 9: case 10: return <Zap className="w-3 h-3" />;
      default: return <Clock className="w-3 h-3" />;
    }
  };

  const getMacroColor = (num) => {
    switch(num) {
      case 1: return 'bg-green-500 text-white';
      case 2: return 'bg-orange-500 text-white';
      case 3: case 4: return 'bg-amber-400 text-amber-900';
      case 5: case 6: return 'bg-purple-400 text-white';
      case 9: case 10: return 'bg-blue-400 text-white';
      default: return 'bg-slate-400 text-white';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="p-6 bg-slate-50/50 border-t border-slate-100"
    >
      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="text-xs text-slate-500 mb-1">Jornada Bruta</div>
          <div className="text-xl font-bold text-slate-700">{minutesToHHMM(jornadaBruta)}</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="text-xs text-slate-500 mb-1">Total Pausas</div>
          <div className="text-xl font-bold text-slate-700">{minutesToHHMM(pausas.total)}</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="text-xs text-slate-500 mb-1">Jornada Líquida</div>
          <div className="text-xl font-bold text-emerald-600">{minutesToHHMM(jornadaLiquida)}</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="text-xs text-slate-500 mb-1">Horas Extras</div>
          <div className={`text-xl font-bold ${horasExtras > 0 ? 'text-red-500' : 'text-slate-400'}`}>
            {minutesToHHMM(horasExtras)}
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="text-xs text-slate-500 mb-1">Limite 12h</div>
          <div className={`text-xl font-bold ${jornadaLiquida > limite12h ? 'text-red-500' : 'text-slate-700'}`}>
            {jornadaLiquida > limite12h ? 'EXCEDIDO' : minutesToHHMM(limite12h - jornadaLiquida)}
          </div>
        </div>
      </div>

      {/* Detalhamento de pausas */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="flex items-center gap-2 bg-amber-50 rounded-lg p-3">
          <Coffee className="w-4 h-4 text-amber-600" />
          <div>
            <div className="text-xs text-amber-600">Refeição</div>
            <div className="font-semibold text-amber-800">{minutesToHHMM(pausas.refeicao)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-purple-50 rounded-lg p-3">
          <Moon className="w-4 h-4 text-purple-600" />
          <div>
            <div className="text-xs text-purple-600">Repouso</div>
            <div className="font-semibold text-purple-800">{minutesToHHMM(pausas.repouso)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-blue-50 rounded-lg p-3">
          <Zap className="w-4 h-4 text-blue-600" />
          <div>
            <div className="text-xs text-blue-600">Complemento</div>
            <div className="font-semibold text-blue-800">{minutesToHHMM(pausas.complemento)}</div>
          </div>
        </div>
      </div>

      {/* Barra de Progresso da Jornada */}
      <div className="mb-6">
        <div className="text-xs text-slate-500 mb-2">Progresso da Jornada</div>
        <div className="relative h-8 bg-slate-200 rounded-full overflow-hidden">
          {/* Jornada líquida */}
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${jornadaPercent}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className={`absolute h-full ${jornadaLiquida > limite12h ? 'bg-red-500' : jornadaLiquida > limite8h ? 'bg-amber-500' : 'bg-emerald-500'}`}
          />
          
          {/* Marcador 8h */}
          <div 
            className="absolute h-full w-0.5 bg-yellow-500"
            style={{ left: `${limite8hPercent}%` }}
          />
          
          {/* Marcador 12h */}
          <div 
            className="absolute h-full w-0.5 bg-red-500"
            style={{ left: `${limitePercent}%` }}
          />
          
          {/* Labels */}
          <div className="absolute inset-0 flex items-center justify-between px-3 text-xs font-medium">
            <span className="text-white drop-shadow">{minutesToHHMM(jornadaLiquida)}</span>
            <span className="text-slate-500">12:00</span>
          </div>
        </div>
        <div className="flex justify-between mt-1 text-xs text-slate-400">
          <span>0h</span>
          <span className="text-yellow-600">8h (limite normal)</span>
          <span className="text-red-500">12h (máximo)</span>
        </div>
      </div>

      {/* Timeline de eventos */}
      <div className="space-y-2">
        <div className="text-xs text-slate-500 mb-3">Linha do Tempo</div>
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200" />
          {sorted.map((macro, idx) => (
            <motion.div
              key={macro.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="relative flex items-center gap-4 py-2"
            >
              <div className={`relative z-10 w-8 h-8 rounded-full ${getMacroColor(macro.numero_macro)} flex items-center justify-center shadow-sm`}>
                {getMacroIcon(macro.numero_macro)}
              </div>
              <div className="flex-1 bg-white rounded-lg p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-slate-700">
                    {MACRO_NAMES[macro.numero_macro]}
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(macro.data_criacao).toLocaleTimeString('pt-BR', { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}