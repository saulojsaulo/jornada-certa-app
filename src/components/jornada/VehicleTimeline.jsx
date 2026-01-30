import React, { useState, useMemo } from 'react';
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
import { Clock, Coffee, Moon, Zap, Play, Square, Trash2, RotateCcw, Pencil } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function VehicleTimeline({ macros, dataReferencia }) {
  const [updatingIds, setUpdatingIds] = useState(new Set());
  const [editingMacro, setEditingMacro] = useState(null);
  const [editForm, setEditForm] = useState({ numero_macro: 1, data: '', hora: '' });
  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ numero_macro: 1, data: '', hora: '' });

  // Usar macros já filtradas (não filtrar novamente)
  const macrosDoDia = useMemo(() => {
    if (!macros || macros.length === 0) return [];
    
    // Dedupicação apenas
    const seen = new Set();
    const unique = [];
    
    macros.forEach(m => {
      const dateToSecond = new Date(m.data_criacao);
      dateToSecond.setMilliseconds(0);
      const key = `${m.numero_macro}-${dateToSecond.toISOString()}`;
      
      if (!seen.has(key)) {
        seen.add(key);
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
        <div className="flex items-center justify-between mb-3">
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
                className="relative flex items-center gap-4 py-2 group"
              >
                <div className={`relative z-10 w-8 h-8 rounded-full ${getMacroColor(macro.numero_macro)} flex items-center justify-center shadow-sm ${isExcluido ? 'opacity-30' : ''}`}>
                  {getMacroIcon(macro.numero_macro)}
                </div>
                <div className={`flex-1 bg-white rounded-lg p-3 shadow-sm ${isExcluido ? 'opacity-50' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-medium text-sm text-slate-700 ${isExcluido ? 'line-through' : ''}`}>
                      {MACRO_NAMES[macro.numero_macro]}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs text-slate-500 ${isExcluido ? 'line-through' : ''}`}>
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