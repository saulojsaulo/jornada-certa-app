import React, { useState, useMemo, useEffect } from 'react';
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
import { Clock, Coffee, Moon, Zap, Play, Square, Trash2, RotateCcw, Pencil, AlertTriangle, MapPin } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

async function fetchCidade(lat, lon) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=pt-BR`, {
      headers: { 'User-Agent': 'JornadaFrota/1.0' }
    });
    const data = await res.json();
    const addr = data.address || {};
    return addr.city || addr.town || addr.village || addr.county || addr.state || null;
  } catch {
    return null;
  }
}

export default function VehicleTimeline({ macros, todasMacrosVeiculo, dataReferencia }) {
  const [updatingIds, setUpdatingIds] = useState(new Set());
  const [editingMacro, setEditingMacro] = useState(null);
  const [editForm, setEditForm] = useState({ numero_macro: 1, data: '', hora: '' });
  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ numero_macro: 1, data: '', hora: '' });
  const [showPreviousJourney, setShowPreviousJourney] = useState(false);
  const [tooltip, setTooltip] = useState(null);
  const [cidades, setCidades] = useState({});

  // Usar macros já filtradas (não filtrar novamente)
  const macrosDoDia = useMemo(() => {
    if (!macros || macros.length === 0) return [];
    
    // Ordenar por data de criação
    const sorted = [...macros].sort((a, b) => new Date(a.data_criacao) - new Date(b.data_criacao));
    
    // Dedupicação inteligente: remover macros duplicadas dentro de 2 minutos
    const unique = [];
    
    sorted.forEach(m => {
      // Verificar se já existe uma macro similar nos últimos 2 minutos
      const isDuplicate = unique.some(existing => {
        if (existing.numero_macro !== m.numero_macro) return false;
        
        const timeDiff = Math.abs(new Date(m.data_criacao) - new Date(existing.data_criacao));
        const minutesDiff = timeDiff / (1000 * 60);
        
        return minutesDiff <= 2;
      });
      
      if (!isDuplicate) {
        unique.push(m);
      }
    });
    
    return unique;
  }, [macros]);

  if (!macrosDoDia || macrosDoDia.length === 0) {
    return (
      <div className="p-6 text-center text-slate-400">
        Nenhum evento registrado neste dia
      </div>
    );
  }

  const handleToggleExcluir = async (macro) => {
    setUpdatingIds(prev => new Set(prev).add(macro.id));
    try {
      await base44.entities.MacroEvento.update(macro.id, {
        excluido: !macro.excluido,
        editado_manualmente: true
      });
    } catch (error) {
      console.error('Erro ao atualizar macro:', error);
    } finally {
      setUpdatingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(macro.id);
        return newSet;
      });
    }
  };

  const handleOpenEdit = (macro) => {
    const dt = new Date(macro.data_criacao);
    setEditForm({
      numero_macro: macro.numero_macro,
      data: dt.toISOString().split('T')[0],
      hora: dt.toTimeString().slice(0, 5)
    });
    setEditingMacro(macro);
  };

  const handleSaveEdit = async () => {
    if (!editingMacro) return;
    
    setUpdatingIds(prev => new Set(prev).add(editingMacro.id));
    try {
      const dataCriacao = new Date(`${editForm.data}T${editForm.hora}:00`).toISOString();
      
      await base44.entities.MacroEvento.update(editingMacro.id, {
        numero_macro: editForm.numero_macro,
        data_criacao: dataCriacao,
        editado_manualmente: true
      });
      
      setEditingMacro(null);
    } catch (error) {
      console.error('Erro ao editar macro:', error);
    } finally {
      setUpdatingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(editingMacro.id);
        return newSet;
      });
    }
  };

  const handleOpenCreate = () => {
    const now = new Date();
    setCreateForm({
      numero_macro: 1,
      data: now.toISOString().split('T')[0],
      hora: now.toTimeString().slice(0, 5)
    });
    setIsCreating(true);
  };

  const handleSaveCreate = async () => {
    if (!macros || macros.length === 0) return;
    
    const veiculoId = macros[0].veiculo_id;
    
    try {
      const dataCriacao = new Date(`${createForm.data}T${createForm.hora}:00`).toISOString();
      const dataJornada = createForm.data;
      const jornadaId = `${veiculoId}-${dataJornada}-${new Date(dataCriacao).getTime()}`;
      
      await base44.entities.MacroEvento.create({
        veiculo_id: veiculoId,
        numero_macro: createForm.numero_macro,
        data_criacao: dataCriacao,
        jornada_id: jornadaId,
        data_jornada: dataJornada,
        editado_manualmente: true
      });
      
      setIsCreating(false);
    } catch (error) {
      console.error('Erro ao criar macro:', error);
    }
  };

  const sorted = [...macrosDoDia].sort((a, b) => new Date(a.data_criacao) - new Date(b.data_criacao));
  
  // Buscar Macro 2 do dia anterior
  const macro2DiaAnterior = useMemo(() => {
    const macrosParaBuscar = todasMacrosVeiculo || macros;
    if (!macrosParaBuscar || macrosParaBuscar.length === 0 || !dataReferencia) return null;
    
    // Pegar todas as Macro 2 anteriores à data de referência
    const macros2Anteriores = macrosParaBuscar
      .filter(m => 
        m.numero_macro === 2 && 
        m.data_jornada && 
        m.data_jornada < dataReferencia &&
        !m.excluido
      )
      .sort((a, b) => new Date(b.data_criacao) - new Date(a.data_criacao));
    
    return macros2Anteriores[0] || null;
  }, [todasMacrosVeiculo, macros, dataReferencia]);
  
  const jornadaBruta = calcularJornadaBruta(macrosDoDia);
  const jornadaLiquida = calcularJornadaLiquida(macrosDoDia);
  const pausas = calcularPausas(macrosDoDia);
  const horasExtras = calcularHorasExtras(macrosDoDia);
  
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
      className="p-4 bg-slate-50/50 border-t border-slate-100"
    >
      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
        {macro2DiaAnterior && (
          <div className="bg-white rounded-lg p-3 shadow-sm">
            <div className="text-xs text-slate-500 mb-1">Fim Jornada Dia Anterior</div>
            <div className="text-sm font-bold text-slate-700">
              {new Date(macro2DiaAnterior.data_criacao).toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })}
            </div>
          </div>
        )}
        <div className="bg-white rounded-lg p-3 shadow-sm">
          <div className="text-xs text-slate-500 mb-0.5">Jornada Bruta</div>
          <div className="text-lg font-bold text-slate-700 font-sans">{minutesToHHMM(jornadaBruta)}</div>
        </div>
        <div className="bg-white rounded-lg p-3 shadow-sm">
          <div className="text-xs text-slate-500 mb-0.5">Total Pausas</div>
          <div className="text-lg font-bold text-slate-700 font-sans">{minutesToHHMM(pausas.total)}</div>
        </div>
        <div className="bg-white rounded-lg p-3 shadow-sm">
          <div className="text-xs text-slate-500 mb-0.5">Jornada Líquida</div>
          <div className="text-lg font-bold text-emerald-600 font-sans">{minutesToHHMM(jornadaLiquida)}</div>
        </div>
        <div className="bg-white rounded-lg p-3 shadow-sm">
          <div className="text-xs text-slate-500 mb-0.5">Horas Extras</div>
          <div className={`text-lg font-bold font-sans ${horasExtras > 0 ? 'text-red-500' : 'text-slate-400'}`}>
            {minutesToHHMM(horasExtras)}
          </div>
        </div>
        <div className="bg-white rounded-lg p-3 shadow-sm">
          <div className="text-xs text-slate-500 mb-0.5">Limite 12h</div>
          <div className={`text-lg font-bold font-sans ${jornadaLiquida > limite12h ? 'text-red-500' : 'text-slate-700'}`}>
            {jornadaLiquida > limite12h ? 'EXCEDIDO' : minutesToHHMM(limite12h - jornadaLiquida)}
          </div>
        </div>
      </div>

      {/* Detalhamento de pausas */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <div className="flex items-center gap-2 bg-amber-50 rounded-lg p-2">
          <Coffee className="w-3.5 h-3.5 text-amber-600" />
          <div>
            <div className="text-xs text-amber-600">Refeição</div>
            <div className="font-semibold text-sm text-amber-800 font-sans">{minutesToHHMM(pausas.refeicao)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-purple-50 rounded-lg p-2">
          <Moon className="w-3.5 h-3.5 text-purple-600" />
          <div>
            <div className="text-xs text-purple-600">Repouso</div>
            <div className="font-semibold text-sm text-purple-800 font-sans">{minutesToHHMM(pausas.repouso)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-blue-50 rounded-lg p-2">
          <Zap className="w-3.5 h-3.5 text-blue-600" />
          <div>
            <div className="text-xs text-blue-600">Complemento</div>
            <div className="font-semibold text-sm text-blue-800 font-sans">{minutesToHHMM(pausas.complemento)}</div>
          </div>
        </div>
        {(() => {
          // Buscar Macro 2 do dia anterior e Macro 1 do dia atual
          const macrosParaBuscar = todasMacrosVeiculo || macros;
          if (!macrosParaBuscar || macrosParaBuscar.length === 0 || !dataReferencia) return null;
          
          const macrosDiaAtual = macrosParaBuscar.filter(m => m.data_jornada === dataReferencia && !m.excluido);
          const macro1Hoje = macrosDiaAtual.find(m => m.numero_macro === 1);
          
          if (!macro1Hoje) return null;
          
          const macros2Anteriores = macrosParaBuscar
            .filter(m => 
              m.numero_macro === 2 && 
              m.data_jornada && 
              m.data_jornada < dataReferencia &&
              !m.excluido
            )
            .sort((a, b) => new Date(b.data_criacao) - new Date(a.data_criacao));
          
          const macro2DiaAnterior = macros2Anteriores[0];
          
          if (!macro2DiaAnterior) return null;
          
          // Calcular interjornada em minutos
          const interjornadaMinutos = (new Date(macro1Hoje.data_criacao) - new Date(macro2DiaAnterior.data_criacao)) / (1000 * 60);
          
          // Mostrar complemento pendente se interjornada < 11h (independente de ter macro 9)
          const temAlerta11h = interjornadaMinutos < 660;
          
          if (!temAlerta11h) return null;
          
          // Calcular complemento pendente (11h - interjornada)
          const complementoPendente = 660 - interjornadaMinutos;
          
          return (
            <div className="flex items-center gap-2 bg-yellow-50 rounded-lg p-2 border border-yellow-200">
              <Zap className="w-3.5 h-3.5 text-yellow-600" />
              <div>
                <div className="text-xs text-yellow-600">Complemento Pendente</div>
                <div className="font-semibold text-sm text-yellow-800 font-sans">{minutesToHHMM(complementoPendente)}</div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Linha do Tempo 24h */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <div className="text-xs text-slate-500">Linha do Tempo (24h)</div>
          <div className="flex items-center gap-3">
            {sorted.length > 0 && sorted[0].jornada_id && dataReferencia && sorted[0].data_jornada !== dataReferencia && (
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={showPreviousJourney}
                  onChange={(e) => setShowPreviousJourney(e.target.checked)}
                  className="rounded"
                />
                <span className="text-slate-600">Exibir jornada do dia anterior</span>
              </label>
            )}
          </div>
        </div>

        <div 
          className="relative h-10 bg-slate-100 rounded-lg overflow-visible border border-slate-200"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = (x / rect.width) * 100;
            const minutes = Math.floor((percent / 100) * 1440);
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            
            // Encontrar o segmento ativo neste ponto
            const dataRef = dataReferencia || new Date().toISOString().split('T')[0];
            const now = new Date();
            const isToday = dataRef === now.toISOString().split('T')[0];
            
            let segmentInfo = { status: 'Sem atividade', isPrevious: false, journeyDate: null };
            
            // Verificar jornada anterior
            const jornadaAnterior = sorted.find(m => 
              m.numero_macro === 1 && 
              m.data_jornada && 
              m.data_jornada !== dataRef &&
              !sorted.find(m2 => m2.numero_macro === 2 && m2.jornada_id === m.jornada_id && new Date(m2.data_criacao) < new Date(dataRef + 'T00:00:00'))
            );
            
            if (jornadaAnterior && showPreviousJourney) {
              const macro2 = sorted.find(m => m.numero_macro === 2 && m.jornada_id === jornadaAnterior.jornada_id);
              if (macro2) {
                const endDate = new Date(macro2.data_criacao);
                const endMinutes = endDate.getHours() * 60 + endDate.getMinutes();
                if (minutes <= endMinutes) {
                  segmentInfo = {
                    status: 'Em Jornada (Macro 1)',
                    isPrevious: true,
                    journeyDate: jornadaAnterior.data_jornada
                  };
                }
              } else if (isToday) {
                const currentMinutes = now.getHours() * 60 + now.getMinutes();
                if (minutes <= currentMinutes) {
                  segmentInfo = {
                    status: 'Em Jornada (Macro 1)',
                    isPrevious: true,
                    journeyDate: jornadaAnterior.data_jornada
                  };
                }
              }
            }
            
            // Verificar macros do dia atual
            for (let i = 0; i < sorted.length; i++) {
              const macro = sorted[i];
              const macroDate = new Date(macro.data_criacao);
              const startMinutes = macroDate.getHours() * 60 + macroDate.getMinutes();
              
              let endMinutes = 1440;
              const nextMacro = sorted[i + 1];
              
              if (nextMacro) {
                const nextDate = new Date(nextMacro.data_criacao);
                endMinutes = nextDate.getHours() * 60 + nextDate.getMinutes();
              } else if (isToday && macro.numero_macro !== 2) {
                endMinutes = now.getHours() * 60 + now.getMinutes();
              }
              
              if (minutes >= startMinutes && minutes < endMinutes) {
                const isPrevDay = macro.data_jornada && macro.data_jornada !== dataRef;
                
                if (macro.numero_macro === 1) {
                  segmentInfo = { status: 'Em Jornada (Macro 1)', isPrevious: isPrevDay, journeyDate: macro.data_jornada };
                } else if (macro.numero_macro === 2) {
                  segmentInfo = { status: 'Interjornada', isPrevious: false, journeyDate: null };
                } else if (macro.numero_macro === 3) {
                  segmentInfo = { status: 'Em Refeição (Macro 3–4)', isPrevious: isPrevDay, journeyDate: macro.data_jornada };
                } else if (macro.numero_macro === 4) {
                  segmentInfo = { status: 'Em Jornada (Macro 4)', isPrevious: isPrevDay, journeyDate: macro.data_jornada };
                } else if (macro.numero_macro === 5) {
                  segmentInfo = { status: 'Em Repouso (Macro 5–6)', isPrevious: isPrevDay, journeyDate: macro.data_jornada };
                } else if (macro.numero_macro === 6) {
                  segmentInfo = { status: 'Em Jornada (Macro 6)', isPrevious: isPrevDay, journeyDate: macro.data_jornada };
                } else if (macro.numero_macro === 9) {
                  segmentInfo = { status: 'Em Complemento (Macro 9–10)', isPrevious: isPrevDay, journeyDate: macro.data_jornada };
                } else if (macro.numero_macro === 10) {
                  segmentInfo = { status: 'Em Jornada (Macro 10)', isPrevious: isPrevDay, journeyDate: macro.data_jornada };
                }
                break;
              }
            }
            
            setTooltip({
              x: e.clientX,
              y: e.clientY,
              hour: `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`,
              ...segmentInfo
            });
          }}
          onMouseLeave={() => setTooltip(null)}
        >
          {/* Segmentos de status */}
          {(() => {
            const segments = [];
            const dataRef = dataReferencia || new Date().toISOString().split('T')[0];
            const now = new Date();
            const isToday = dataRef === now.toISOString().split('T')[0];

            // Verificar se há jornada do dia anterior que continua neste dia
            const jornadaAnterior = sorted.find(m => 
              m.numero_macro === 1 && 
              m.data_jornada && 
              m.data_jornada !== dataRef &&
              !sorted.find(m2 => m2.numero_macro === 2 && m2.jornada_id === m.jornada_id && new Date(m2.data_criacao) < new Date(dataRef + 'T00:00:00'))
            );

            if (jornadaAnterior && showPreviousJourney) {
              const macro2 = sorted.find(m => m.numero_macro === 2 && m.jornada_id === jornadaAnterior.jornada_id);
              if (macro2) {
                const endDate = new Date(macro2.data_criacao);
                const refDate = new Date(dataRef + 'T00:00:00');
                if (endDate > refDate) {
                  const endMinutes = endDate.getHours() * 60 + endDate.getMinutes();
                  const endPercent = (endMinutes / 1440) * 100;

                  segments.push({
                    left: 0,
                    width: endPercent,
                    color: 'bg-green-500/40 border-2 border-dashed border-green-600',
                    label: 'Jornada anterior'
                  });
                }
              } else if (isToday) {
                // Jornada anterior ainda em andamento
                const currentMinutes = now.getHours() * 60 + now.getMinutes();
                const currentPercent = (currentMinutes / 1440) * 100;
                
                segments.push({
                  left: 0,
                  width: currentPercent,
                  color: 'bg-green-500/40 border-2 border-dashed border-green-600',
                  label: 'Jornada anterior (em andamento)'
                });
              }
            }

            // Processar macros do dia atual
            for (let i = 0; i < sorted.length; i++) {
              const macro = sorted[i];
              const macroDate = new Date(macro.data_criacao);
              const startMinutes = macroDate.getHours() * 60 + macroDate.getMinutes();

              let endMinutes = 1440; // fim do dia por padrão
              const nextMacro = sorted[i + 1];

              if (nextMacro) {
                const nextDate = new Date(nextMacro.data_criacao);
                endMinutes = nextDate.getHours() * 60 + nextDate.getMinutes();
              } else if (isToday && macro.numero_macro !== 2) {
                // Se não há próxima macro e é hoje e não é fim de jornada, vai até agora
                endMinutes = now.getHours() * 60 + now.getMinutes();
              }

              const leftPercent = (startMinutes / 1440) * 100;
              const widthPercent = ((endMinutes - startMinutes) / 1440) * 100;

              if (widthPercent <= 0) continue; // Não renderizar segmentos vazios

              let color = 'bg-slate-300';
              let label = '';

              if (macro.numero_macro === 1) {
                color = 'bg-green-500';
                label = 'Em Jornada';
              } else if (macro.numero_macro === 2) {
                color = 'bg-white';
                label = 'Interjornada';
              } else if (macro.numero_macro === 3) {
                color = 'bg-amber-300';
                label = 'Refeição';
              } else if (macro.numero_macro === 4) {
                color = 'bg-green-500';
                label = 'Em Jornada';
              } else if (macro.numero_macro === 5) {
                color = 'bg-pink-300';
                label = 'Repouso';
              } else if (macro.numero_macro === 6) {
                color = 'bg-green-500';
                label = 'Em Jornada';
              } else if (macro.numero_macro === 9) {
                color = 'bg-blue-300';
                label = 'Complemento';
              } else if (macro.numero_macro === 10) {
                color = 'bg-green-500';
                label = 'Em Jornada';
              }

              segments.push({
                left: leftPercent,
                width: widthPercent,
                color,
                label
              });
            }

            return segments.map((seg, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.1 }}
                className={`absolute h-full ${seg.color}`}
                style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
              />
            ));
          })()}

          {/* Marcadores de tempo - régua de horas */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Linhas de hora em hora do relógio */}
            {[0, 2, 4, 6, 10, 14, 16, 18, 20, 22].map(hour => {
              const leftPercent = (hour / 24) * 100;
              return (
                <div 
                  key={hour}
                  className="absolute h-full w-px bg-slate-300"
                  style={{ left: `${leftPercent}%` }}
                >
                  <div 
                    className={`absolute ${hour % 4 === 0 ? '-top-5' : '-bottom-5'} -left-3 text-xs font-medium text-slate-500 font-sans`}
                  >
                    {String(hour).padStart(2, '0')}:00
                  </div>
                </div>
              );
            })}
            
            {/* Marcadores de 8h e 12h de jornada líquida */}
            {(() => {
              const macro1 = sorted.find(m => m.numero_macro === 1);
              if (!macro1) return null;
              
              const startDate = new Date(macro1.data_criacao);
              const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
              
              // Calcular posição de 8h de jornada líquida
              let accumulated8h = 0;
              let position8h = null;
              
              // Calcular posição de 12h de jornada líquida  
              let accumulated12h = 0;
              let position12h = null;
              
              for (let i = 0; i < sorted.length; i++) {
                const macro = sorted[i];
                const macroDate = new Date(macro.data_criacao);
                const macroMinutes = macroDate.getHours() * 60 + macroDate.getMinutes();
                
                const nextMacro = sorted[i + 1];
                let nextMinutes = 1440;
                if (nextMacro) {
                  const nextDate = new Date(nextMacro.data_criacao);
                  nextMinutes = nextDate.getHours() * 60 + nextDate.getMinutes();
                }
                
                // Contar apenas se está em jornada (não é pausa)
                const isWorking = [1, 4, 6, 10].includes(macro.numero_macro);
                
                if (isWorking) {
                  const segmentDuration = nextMinutes - macroMinutes;
                  
                  // Verificar 8h
                  if (!position8h) {
                    if (accumulated8h + segmentDuration >= 480) {
                      const remaining = 480 - accumulated8h;
                      position8h = macroMinutes + remaining;
                    } else {
                      accumulated8h += segmentDuration;
                    }
                  }
                  
                  // Verificar 12h
                  if (!position12h) {
                    if (accumulated12h + segmentDuration >= 720) {
                      const remaining = 720 - accumulated12h;
                      position12h = macroMinutes + remaining;
                    } else {
                      accumulated12h += segmentDuration;
                    }
                  }
                }
              }
              
              return (
                <>
                  {position8h && (
                    <div 
                      className="absolute h-full w-0.5 bg-yellow-500"
                      style={{ left: `${(position8h / 1440) * 100}%` }}
                    >
                      <div className="absolute -top-5 -left-6 text-xs font-medium text-yellow-600 whitespace-nowrap">
                        8h líquidas
                      </div>
                    </div>
                  )}
                  
                  {position12h && (
                    <div 
                      className="absolute h-full w-0.5 bg-red-500"
                      style={{ left: `${(position12h / 1440) * 100}%` }}
                    >
                      <div className="absolute -bottom-5 -left-6 text-xs font-medium text-red-600 whitespace-nowrap">
                        12h líquidas
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
        
        {/* Tooltip */}
        {tooltip && (
          <div 
            className="fixed z-50 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-lg pointer-events-none"
            style={{ 
              left: `${tooltip.x + 10}px`, 
              top: `${tooltip.y - 40}px`,
              transform: 'translateY(-100%)'
            }}
          >
            <div className="font-semibold">{tooltip.hour}</div>
            <div className="text-slate-300">{tooltip.status}</div>
            {tooltip.isPrevious && (
              <div className="text-amber-300 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Jornada do dia {tooltip.journeyDate}
              </div>
            )}
            {tooltip.journeyDate && !tooltip.isPrevious && (
              <div className="text-slate-400 text-[10px] mt-0.5">
                Jornada de {tooltip.journeyDate}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-center gap-4 mt-4 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-green-500 rounded"></div>
            <span className="text-slate-600">Em Jornada</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-amber-300 rounded"></div>
            <span className="text-slate-600">Refeição</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-pink-300 rounded"></div>
            <span className="text-slate-600">Repouso</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-blue-300 rounded"></div>
            <span className="text-slate-600">Complemento</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-white border border-slate-300 rounded"></div>
            <span className="text-slate-600">Interjornada</span>
          </div>
        </div>
      </div>

      {/* Timeline de eventos */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-slate-500">Linha do Tempo</div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenCreate}
            className="h-7 text-xs"
          >
            <Play className="w-3 h-3 mr-1" />
            Nova Macro
          </Button>
        </div>
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200" />
          {sorted.map((macro, idx) => {
            const isUpdating = updatingIds.has(macro.id);
            const isExcluido = macro.excluido;
            
            return (
              <motion.div
                key={macro.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="relative flex items-center gap-3 py-1.5 group"
              >
                <div className={`relative z-10 w-7 h-7 rounded-full ${getMacroColor(macro.numero_macro)} flex items-center justify-center shadow-sm ${isExcluido ? 'opacity-30' : ''}`}>
                  {getMacroIcon(macro.numero_macro)}
                </div>
                <div className={`flex-1 bg-white rounded-lg p-2 shadow-sm ${isExcluido ? 'opacity-50' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className={`font-medium text-sm text-slate-700 shrink-0 ${isExcluido ? 'line-through' : ''}`}>
                        {MACRO_NAMES[macro.numero_macro]}
                      </span>
                      {(macro.endereco || (macro.latitude && macro.longitude)) && (
                        <a
                          href={macro.latitude && macro.longitude ? `https://www.google.com/maps?q=${macro.latitude},${macro.longitude}` : undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-500 transition-colors truncate min-w-0"
                          onClick={e => e.stopPropagation()}
                        >
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="truncate">{macro.endereco || `${macro.latitude?.toFixed(5)}, ${macro.longitude?.toFixed(5)}`}</span>
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs text-slate-500 font-sans ${isExcluido ? 'line-through' : ''}`}>
                        {new Date(macro.data_criacao).toLocaleTimeString('pt-BR', { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </span>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleOpenEdit(macro)}
                          disabled={isUpdating}
                        >
                          <Pencil className="h-3 w-3 text-blue-500" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleToggleExcluir(macro)}
                          disabled={isUpdating}
                        >
                          {isExcluido ? (
                            <RotateCcw className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <Trash2 className="h-3 w-3 text-red-500" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                  {isExcluido && (
                    <div className="text-xs text-red-500 mt-1">Excluído manualmente</div>
                  )}
                  {macro.editado_manualmente && !isExcluido && (
                    <div className="text-xs text-blue-500 mt-1">Editado manualmente</div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Dialog de Criação */}
      <Dialog open={isCreating} onOpenChange={() => setIsCreating(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Macro Manual</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Tipo de Evento</Label>
              <Select 
                value={String(createForm.numero_macro)} 
                onValueChange={(v) => setCreateForm({...createForm, numero_macro: parseInt(v)})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MACRO_NAMES).map(([num, nome]) => (
                    <SelectItem key={num} value={num}>{nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Data</Label>
                <Input 
                  type="date" 
                  value={createForm.data}
                  onChange={(e) => setCreateForm({...createForm, data: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label>Hora</Label>
                <Input 
                  type="time" 
                  value={createForm.hora}
                  onChange={(e) => setCreateForm({...createForm, hora: e.target.value})}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreating(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveCreate}>
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de Edição */}
      <Dialog open={!!editingMacro} onOpenChange={() => setEditingMacro(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Lançamento</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Tipo de Evento</Label>
              <Select 
                value={String(editForm.numero_macro)} 
                onValueChange={(v) => setEditForm({...editForm, numero_macro: parseInt(v)})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MACRO_NAMES).map(([num, nome]) => (
                    <SelectItem key={num} value={num}>{nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Data</Label>
                <Input 
                  type="date" 
                  value={editForm.data}
                  onChange={(e) => setEditForm({...editForm, data: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label>Hora</Label>
                <Input 
                  type="time" 
                  value={editForm.hora}
                  onChange={(e) => setEditForm({...editForm, hora: e.target.value})}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingMacro(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveEdit}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}