import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Truck, RefreshCw, Clock, TrendingUp, UserSearch } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import ControleTab from '../components/jornada/ControleTab';
import RankingTab from '../components/jornada/RankingTab';
import FiltroMotoristaTab from '../components/jornada/FiltroMotoristaTab';

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
    
    // Para cada veículo, calcular jornadas logicamente
    Object.values(macrosPorVeiculo).forEach(macrosVeiculo => {
      macrosVeiculo.sort((a, b) => new Date(a.data_criacao) - new Date(b.data_criacao));
      
      let jornadaAtual = null;
      
      macrosVeiculo.forEach(m => {
        // Se não tem jornada_id, calcular
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
          // Atualizar estado da jornada atual baseado nos dados
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
              {lastImport && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-600 bg-white rounded-xl shadow-sm border border-slate-200">
                  <Clock className="w-3 h-3 text-slate-400" />
                  <span>
                    Última Importação: {format(new Date(lastImport.imported_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                  </span>
                </div>
              )}

              {/* Relógio */}
              <div className="hidden md:flex items-center gap-2 bg-slate-100 rounded-xl px-4 py-2">
                <span className="text-2xl font-mono font-bold text-slate-700">
                  {format(currentTime, 'HH:mm:ss')}
                </span>
              </div>

              {/* Atualizar */}
              <Button
                variant="outline"
                size="icon"
                onClick={handleRefresh}
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full max-w-2xl grid-cols-3 mx-auto">
            <TabsTrigger value="controle" className="gap-2">
              <Truck className="w-4 h-4" />
              Controle
            </TabsTrigger>
            <TabsTrigger value="ranking" className="gap-2">
              <TrendingUp className="w-4 h-4" />
              Ranking
            </TabsTrigger>
            <TabsTrigger value="filtro" className="gap-2">
              <UserSearch className="w-4 h-4" />
              Filtro de Motorista
            </TabsTrigger>
          </TabsList>

          <TabsContent value="controle">
            <ControleTab onImportLogUpdate={refetchImportLogs} />
          </TabsContent>

          <TabsContent value="ranking">
            <RankingTab />
          </TabsContent>

          <TabsContent value="filtro">
            <FiltroMotoristaTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}