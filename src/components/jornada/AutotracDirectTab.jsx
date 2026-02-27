import React, { useState, useMemo, useEffect } from 'react';
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
  const [veiculos, setVeiculos] = useState([]);
  const [macros, setMacros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncInProgress, setSyncInProgress] = useState(false);

  // Carregar veículos direto da Autotrac (sem usar banco de dados)
  useEffect(() => {
    const fetchVehiclesFromAutotrac = async () => {
      try {
        setLoading(true);
        const result = await base44.functions.invoke('autotracGetAllVehicles', {});
        
        if (result.data.success && result.data.vehicles && result.data.vehicles.length > 0) {
          setVeiculos(result.data.vehicles);
        } else {
          toast.error('Nenhum veículo encontrado na API Autotrac');
        }
      } catch (error) {
        toast.error('Erro ao carregar veículos: ' + error.message);
      } finally {
        setLoading(false);
      }
    };

    fetchVehiclesFromAutotrac();
  }, []);

  const motoristas = [];
  const gestores = [];

  const dateString = format(selectedDate, 'yyyy-MM-dd');
  const yesterdayString = format(new Date(selectedDate.getTime() - 86400000), 'yyyy-MM-dd');

  const macrosPorVeiculo = useMemo(() => {
    const map = {};
    macros.filter(m => m.data_jornada === dateString).forEach(m => {
      if (!map[m.veiculo_id]) map[m.veiculo_id] = [];
      map[m.veiculo_id].push(m);
    });
    return map;
  }, [macros, dateString]);

  const macrosOntemPorVeiculo = useMemo(() => {
    const map = {};
    macros.filter(m => m.data_jornada === yesterdayString).forEach(m => {
      if (!map[m.veiculo_id]) map[m.veiculo_id] = [];
      map[m.veiculo_id].push(m);
    });
    return map;
  }, [macros, yesterdayString]);

  const todasMacrosPorVeiculo = useMemo(() => {
    const map = {};
    macros.forEach(m => {
      if (!map[m.veiculo_id]) map[m.veiculo_id] = [];
      map[m.veiculo_id].push(m);
    });
    return map;
  }, [macros]);

  const handleSyncFromAutotrac = async () => {
    setSyncInProgress(true);
    try {
      const toastId = toast.loading('Sincronizando com Autotrac...');
      
      // Chamar função para puxar todas as mensagens dos veículos
      for (const veiculo of veiculos) {
        const result = await base44.functions.invoke('autotracDiagV2', { 
          step: 'messages',
          vehicleCode: parseInt(veiculo.autotrac_id)
        });
        
        if (result.data.status !== 200) {
          console.warn(`Erro ao sincronizar veículo ${veiculo.nome_veiculo}`);
        }
      }
      
      toast.success('Sincronização com Autotrac concluída!', { id: toastId });
    } catch (error) {
      toast.error('Erro na sincronização: ' + error.message);
    } finally {
      setSyncInProgress(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        <span className="ml-3 text-slate-600">Carregando veículos da Autotrac...</span>
      </div>
    );
  }

  if (veiculos.length === 0) {
    return (
      <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
        <AlertCircle className="w-5 h-5" />
        <span>Nenhum veículo encontrado na API Autotrac</span>
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

      {/* Info */}
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <strong>{veiculos.length} veículos</strong> carregados direto da Autotrac (sem usar banco de dados)
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