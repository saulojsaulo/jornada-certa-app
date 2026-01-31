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

export default function ControleTab({ onImportLogUpdate }) {
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Buscar veículos
  const { data: veiculos = [], isLoading: loadingVeiculos, refetch: refetchVeiculos } = useQuery({
    queryKey: ['veiculos'],
    queryFn: () => base44.entities.Veiculo.list(),
  });

  // Buscar macros
  const { data: fetchedMacros = [], isLoading: loadingMacros, refetch: refetchMacros } = useQuery({
    queryKey: ['macros'],
    queryFn: () => base44.entities.MacroEvento.list('-data_criacao', 50000),
  });

  // Dedupicação e cálculo de jornadas lógicas
  const macros = useMemo(() => {
    const seen = new Set();
    const uniqueMacros = [];
    
    fetchedMacros.forEach(m => {
      const dateToSecond = new Date(m.data_criacao);
      dateToSecond.setMilliseconds(0);
      const key = `${m.veiculo_id}-${m.numero_macro}-${dateToSecond.toISOString()}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        uniqueMacros.push(m);
      }
    });
    
    // Calcular jornada_id e data_jornada para macros antigas
    const macrosPorVeiculo = {};
    uniqueMacros.forEach(m => {
      if (!macrosPorVeiculo[m.veiculo_id]) {
        macrosPorVeiculo[m.veiculo_id] = [];
      }
      macrosPorVeiculo[m.veiculo_id].push(m);
    });
    
    Object.values(macrosPorVeiculo).forEach(macrosVeiculo => {
      macrosVeiculo.sort((a, b) => new Date(a.data_criacao) - new Date(b.data_criacao));
      
      let jornadaAtual = null;
      
      macrosVeiculo.forEach(m => {
        if (!m.jornada_id) {
          if (m.numero_macro === 1) {
            const dataJornada = new Date(m.data_criacao).toISOString().split('T')[0];
            jornadaAtual = {
              jornadaId: `${m.veiculo_id}-${dataJornada}-${new Date(m.data_criacao).getTime()}`,
              dataJornada: dataJornada,
              aberta: true
            };
            m.jornada_id = jornadaAtual.jornadaId;
            m.data_jornada = jornadaAtual.dataJornada;
          } else if (jornadaAtual && jornadaAtual.aberta) {
            m.jornada_id = jornadaAtual.jornadaId;
            m.data_jornada = jornadaAtual.dataJornada;
            
            if (m.numero_macro === 2) {
              jornadaAtual.aberta = false;
            }
          }
        } else {
          if (m.numero_macro === 1) {
            jornadaAtual = {
              jornadaId: m.jornada_id,
              dataJornada: m.data_jornada,
              aberta: true
            };
          } else if (m.numero_macro === 2 && jornadaAtual) {
            jornadaAtual.aberta = false;
          }
        }
      });
    });
    
    return uniqueMacros;
  }, [fetchedMacros]);

  // Filtrar macros por jornada lógica
  const dateString = format(selectedDate, 'yyyy-MM-dd');
  const yesterdayString = format(new Date(selectedDate.getTime() - 86400000), 'yyyy-MM-dd');

  const { macrosHoje, macrosOntem } = useMemo(() => {
    const hoje = macros.filter(m => m.data_jornada === dateString && !m.excluido);
    const ontem = macros.filter(m => m.data_jornada === yesterdayString && !m.excluido);
    return { macrosHoje: hoje, macrosOntem: ontem };
  }, [macros, dateString, yesterdayString]);

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

  const handleImportComplete = () => {
    refetchVeiculos();
    refetchMacros();
    if (onImportLogUpdate) onImportLogUpdate();
  };

  return (
    <div className="space-y-6">
      {/* Controles */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ImportXLSX onImportComplete={handleImportComplete} onImportLogUpdate={onImportLogUpdate} />
        
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
          macrosPorVeiculo={macrosPorVeiculo}
          macrosOntemPorVeiculo={macrosOntemPorVeiculo}
        />
      </motion.div>
    </div>
  );
}