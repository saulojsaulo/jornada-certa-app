import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { Calendar } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import ImportXLSX from './ImportXLSX';
import StatsCards from './StatsCards';
import VehicleGrid from './VehicleGrid';
import SincronizarAutotrac from './SincronizarAutotrac';

export default function ControleTab({ onImportLogUpdate }) {
  const [selectedDate, setSelectedDate] = useState(new Date());

  const dateString = format(selectedDate, 'yyyy-MM-dd');
  const yesterdayString = format(new Date(selectedDate.getTime() - 86400000), 'yyyy-MM-dd');

  // Buscar veículos
  const { data: veiculos = [], isLoading: loadingVeiculos, refetch: refetchVeiculos } = useQuery({
    queryKey: ['veiculos'],
    queryFn: () => base44.entities.Veiculo.list(),
  });

  // Buscar motoristas
  const { data: motoristas = [] } = useQuery({
    queryKey: ['motoristas'],
    queryFn: () => base44.entities.Motorista.list(),
  });

  // Buscar gestores
  const { data: gestores = [] } = useQuery({
    queryKey: ['gestores'],
    queryFn: () => base44.entities.Gestor.list(),
  });

  // Buscar macros APENAS dos dois dias relevantes (hoje e ontem), direto no banco
  const { data: macrosHojeRaw = [], isLoading: loadingHoje, refetch: refetchHoje } = useQuery({
    queryKey: ['macros', dateString],
    queryFn: () => base44.entities.MacroEvento.filter({ data_jornada: dateString, excluido: false }, '-data_criacao', 10000),
  });

  const { data: macrosOntemRaw = [], isLoading: loadingOntem, refetch: refetchOntem } = useQuery({
    queryKey: ['macros', yesterdayString],
    queryFn: () => base44.entities.MacroEvento.filter({ data_jornada: yesterdayString, excluido: false }, '-data_criacao', 10000),
  });

  const loadingMacros = loadingHoje || loadingOntem;
  const refetchMacros = () => { refetchHoje(); refetchOntem(); };

  // Deduplicar por chave única (tolerância de 1 segundo)
  const dedup = (list) => {
    const seen = new Set();
    return list.filter(m => {
      const d = new Date(m.data_criacao);
      d.setMilliseconds(0);
      const key = `${m.veiculo_id}-${m.numero_macro}-${d.toISOString()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const macrosHoje   = useMemo(() => dedup(macrosHojeRaw),  [macrosHojeRaw]);
  const macrosOntem  = useMemo(() => dedup(macrosOntemRaw), [macrosOntemRaw]);

  // Agrupar macros por veículo
  const macrosPorVeiculo = useMemo(() => {
    const map = {};
    macrosHoje.forEach(m => {
      if (!map[m.veiculo_id]) map[m.veiculo_id] = [];
      map[m.veiculo_id].push(m);
    });
    return map;
  }, [macrosHoje]);

  const macrosOntemPorVeiculo = useMemo(() => {
    const map = {};
    macrosOntem.forEach(m => {
      if (!map[m.veiculo_id]) map[m.veiculo_id] = [];
      map[m.veiculo_id].push(m);
    });
    return map;
  }, [macrosOntem]);

  // todasMacrosPorVeiculo: usa hoje + ontem (suficiente para cálculo de Macro 2 anterior)
  const todasMacrosPorVeiculo = useMemo(() => {
    const map = {};
    [...macrosHoje, ...macrosOntem].forEach(m => {
      if (!map[m.veiculo_id]) map[m.veiculo_id] = [];
      map[m.veiculo_id].push(m);
    });
    return map;
  }, [macrosHoje, macrosOntem]);

  const handleImportComplete = () => {
    refetchVeiculos();
    refetchMacros();
    if (onImportLogUpdate) onImportLogUpdate();
  };

  return (
    <div className="space-y-6">
      {/* Controles */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <ImportXLSX onImportComplete={handleImportComplete} onImportLogUpdate={onImportLogUpdate} />
          <SincronizarAutotrac onSyncComplete={handleImportComplete} selectedDate={selectedDate} />
        </div>
        
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Calendar className="w-4 h-4" />
              {format(selectedDate, 'dd/MM/yyyy', { locale: ptBR })}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <CalendarComponent
              mode="single"
              selected={selectedDate}
              onSelect={(date) => date && setSelectedDate(date)}
              locale={ptBR}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Aviso: data histórica sem macros */}
      {dateString !== new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()) && !loadingMacros && macrosHoje.length === 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <span className="text-lg">⚠️</span>
          <div>
            <span className="font-semibold">Nenhuma macro encontrada para {format(selectedDate, 'dd/MM/yyyy', { locale: ptBR })}.</span>
            {' '}Use o botão <strong>"Sincronizar Autotrac"</strong> acima para importar os dados desta data.
          </div>
        </div>
      )}

      {/* Stats */}
      <StatsCards 
        veiculos={veiculos}
        macrosPorVeiculo={macrosPorVeiculo}
        macrosOntemPorVeiculo={macrosOntemPorVeiculo}
      />

      {/* Grid de Veículos */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <VehicleGrid
          veiculos={veiculos}
          motoristas={motoristas}
          gestores={gestores}
          macrosPorVeiculo={macrosPorVeiculo}
          macrosOntemPorVeiculo={macrosOntemPorVeiculo}
          todasMacrosPorVeiculo={todasMacrosPorVeiculo}
          selectedDate={dateString}
        />
      </motion.div>
    </div>
  );
}