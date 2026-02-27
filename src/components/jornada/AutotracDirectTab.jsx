import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { Calendar, Loader2, AlertCircle } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from "sonner";

import StatsCards from './StatsCards';
import VehicleGrid from './VehicleGrid';

export default function AutotracDirectTab() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [rawMacros, setRawMacros] = useState([]);
  const [syncInProgress, setSyncInProgress] = useState(false);

  // Buscar veículos
  const { data: veiculos = [], isLoading: loadingVeiculos } = useQuery({
    queryKey: ['veiculos'],
    queryFn: () => base44.entities.Veiculo.list(undefined, 500), // Buscar até 500 veículos
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

  // Carregar macros do banco de dados ao inicializar
  useEffect(() => {
    const loadMacrosFromDatabase = async () => {
      try {
        const macros = await base44.entities.MacroEvento.list(undefined, 5000);
        
        // Mapear para o formato esperado
        const mappedMacros = await Promise.all(
          macros.map(async (m) => {
            const veiculo = veiculos.find(v => v.id === m.veiculo_id);
            return {
              veiculo_code: veiculo?.autotrac_id || m.veiculo_id,
              veiculo_id: m.veiculo_id,
              veiculo_nome: veiculo?.nome_veiculo || 'Desconhecido',
              placa: veiculo?.placa || '',
              numero_macro: m.numero_macro,
              data_criacao: m.data_criacao,
              jornada_id: m.jornada_id,
              data_jornada: m.data_jornada
            };
          })
        );
        
        setRawMacros(mappedMacros);
      } catch (error) {
        console.error('Erro ao carregar macros:', error);
      }
    };
    
    if (veiculos.length > 0) {
      loadMacrosFromDatabase();
    }
  }, [veiculos]);

  const dateString = format(selectedDate, 'yyyy-MM-dd');
  const yesterdayString = format(new Date(selectedDate.getTime() - 86400000), 'yyyy-MM-dd');

  // Mapear veículos da Autotrac com veículos do banco (igual ControleTab)
  const vehicleMap = useMemo(() => {
    const map = {};
    veiculos.forEach(v => {
      if (v.autotrac_id) {
        map[String(v.autotrac_id)] = v;
      }
    });
    return map;
  }, [veiculos]);

  // Processar macros com as mesmas regras da aba Controle
  const macros = useMemo(() => {
    return rawMacros
      .map(m => {
        const veiculo = vehicleMap[String(m.veiculo_code)];
        return {
          ...m,
          veiculo_id: veiculo?.id || null,
          data_criacao: m.data_criacao,
          numero_macro: m.numero_macro
        };
      })
      .filter(m => m.veiculo_id); // Apenas veículos mapeados
  }, [rawMacros, vehicleMap]);

  // Dedupicação (igual ControleTab)
  const macrosUnicos = useMemo(() => {
    const seen = new Set();
    const uniqueMacros = [];
    
    macros.forEach(m => {
      const dateToSecond = new Date(m.data_criacao);
      dateToSecond.setMilliseconds(0);
      const key = `${m.veiculo_id}-${m.numero_macro}-${dateToSecond.toISOString()}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        uniqueMacros.push(m);
      }
    });

    // Calcular jornada_id e data_jornada (igual ControleTab)
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
      });
    });
    
    return uniqueMacros;
  }, [macros]);

  // Filtrar por data (igual ControleTab)
  const { macrosHoje, macrosOntem } = useMemo(() => {
    const hoje = macrosUnicos.filter(m => m.data_jornada === dateString);
    const ontem = macrosUnicos.filter(m => m.data_jornada === yesterdayString);
    return { macrosHoje: hoje, macrosOntem: ontem };
  }, [macrosUnicos, dateString, yesterdayString]);

  // Agrupar por veículo (igual ControleTab)
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

  const todasMacrosPorVeiculo = useMemo(() => {
    const map = {};
    macrosUnicos.forEach(m => {
      if (!map[m.veiculo_id]) map[m.veiculo_id] = [];
      map[m.veiculo_id].push(m);
    });
    return map;
  }, [macrosUnicos]);

  const handleSyncFromAutotrac = async () => {
    setSyncInProgress(true);
    try {
      // Primeiro: Sincronizar veículos
      const toastId = toast.loading('Sincronizando 229 veículos com Autotrac...');
      
      const syncVehicles = await base44.functions.invoke('autotracSyncVehiclesQuick', {});
      
      if (!syncVehicles.data.success) {
        toast.error('Erro ao sincronizar veículos', { id: toastId });
        setSyncInProgress(false);
        return;
      }

      toast.loading(`Sincronizados ${syncVehicles.data.total_vehicles} veículos. Buscando macros...`, { id: toastId });

      // Segundo: Buscar macros
      const result = await base44.functions.invoke('autotracDebugAllMacros', {});
      
      if (result.data.success) {
        setRawMacros(result.data.macros || []);
        toast.success(`${result.data.total_macros} macros carregadas de ${result.data.total_vehicles} veículos!`, { id: toastId });
      } else {
        toast.error('Erro ao buscar macros', { id: toastId });
      }
    } catch (error) {
      toast.error('Erro na sincronização: ' + error.message);
    } finally {
      setSyncInProgress(false);
    }
  };



  if (loadingVeiculos) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        <span className="ml-3 text-slate-600">Carregando veículos...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Controles */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button 
          onClick={handleSyncFromAutotrac}
          disabled={syncInProgress}
          className="bg-emerald-600 hover:bg-emerald-700 gap-2"
        >
          {syncInProgress ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : null}
          Sincronizar com Autotrac
        </Button>
        
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
          motoristas={motoristas}
          gestores={gestores}
          macrosPorVeiculo={macrosPorVeiculo}
          macrosOntemPorVeiculo={macrosOntemPorVeiculo}
          todasMacrosPorVeiculo={todasMacrosPorVeiculo}
        />
      </motion.div>
    </div>
  );
}