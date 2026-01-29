import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Truck, RefreshCw, Calendar, Clock } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import ImportXLSX from '../components/jornada/ImportXLSX';
import StatsCards from '../components/jornada/StatsCards';
import VehicleGrid from '../components/jornada/VehicleGrid';

export default function Jornada() {
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [currentTime, setCurrentTime] = useState(new Date());

  // Atualizar relógio a cada segundo
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Buscar veículos
  const { data: veiculos = [], isLoading: loadingVeiculos, refetch: refetchVeiculos } = useQuery({
    queryKey: ['veiculos'],
    queryFn: () => base44.entities.Veiculo.list(),
  });

  // Buscar macros
  const { data: macros = [], isLoading: loadingMacros, refetch: refetchMacros } = useQuery({
    queryKey: ['macros'],
    queryFn: () => base44.entities.MacroEvento.list('-data_criacao', 10000),
  });

  // Buscar último log de importação
  const { data: importLogs = [], refetch: refetchImportLogs } = useQuery({
    queryKey: ['importLogs'],
    queryFn: () => base44.entities.ImportLog.list('-imported_at', 1),
  });

  const lastImport = importLogs[0] || null;

  // Subscription para atualizações em tempo real
  useEffect(() => {
    const unsubVeiculos = base44.entities.Veiculo.subscribe(() => {
      refetchVeiculos();
    });

    const unsubMacros = base44.entities.MacroEvento.subscribe(() => {
      refetchMacros();
    });

    return () => {
      unsubVeiculos();
      unsubMacros();
    };
  }, [refetchVeiculos, refetchMacros]);

  // Filtrar macros por data
  const dateString = format(selectedDate, 'yyyy-MM-dd');
  const yesterdayString = format(new Date(selectedDate.getTime() - 86400000), 'yyyy-MM-dd');

  const { macrosHoje, macrosOntem } = useMemo(() => {
    const hoje = macros.filter(m => m.data_referencia === dateString);
    const ontem = macros.filter(m => m.data_referencia === yesterdayString);
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
    refetchImportLogs();
  };

  const handleRefresh = () => {
    refetchVeiculos();
    refetchMacros();
  };

  const isLoading = loadingVeiculos || loadingMacros;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-lg border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
                <Truck className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-800">Controle de Jornada</h1>
                <p className="text-sm text-slate-500">Sistema de Monitoramento de Motoristas</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Botão Importar */}
              <ImportXLSX onImportComplete={handleImportComplete} onImportLogUpdate={refetchImportLogs} />

              {/* Última Importação */}
              {lastImport && (
                <div className="hidden lg:flex items-center gap-2 bg-emerald-50 rounded-xl px-3 py-2 text-sm">
                  <Clock className="w-4 h-4 text-emerald-600" />
                  <span className="text-emerald-700">
                    Última importação: {format(new Date(lastImport.imported_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })} por <strong>{lastImport.imported_by}</strong>
                  </span>
                </div>
              )}

              {/* Relógio */}
              <div className="hidden md:flex items-center gap-2 bg-slate-100 rounded-xl px-4 py-2">
                <span className="text-2xl font-mono font-bold text-slate-700">
                  {format(currentTime, 'HH:mm:ss')}
                </span>
              </div>

              {/* Seletor de Data */}
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

              {/* Atualizar */}
              <Button
                variant="outline"
                size="icon"
                onClick={handleRefresh}
                disabled={isLoading}
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Stats e Import */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3">
            <StatsCards 
              veiculos={veiculos}
              macrosPorVeiculo={macrosPorVeiculo}
              macrosOntemPorVeiculo={macrosOntemPorVeiculo}
            />
          </div>
          <div className="lg:col-span-1">
            <ImportXLSX onImportComplete={handleImportComplete} onImportLogUpdate={refetchImportLogs} />
          </div>
        </div>

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
      </main>
    </div>
  );
}