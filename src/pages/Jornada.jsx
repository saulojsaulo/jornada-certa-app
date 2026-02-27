import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Truck, RefreshCw, Clock, TrendingUp, UserSearch, Database, Loader2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import ControleTab from '../components/jornada/ControleTab';
import RankingTab from '../components/jornada/RankingTab';
import FiltroMotoristaTab from '../components/jornada/FiltroMotoristaTab';

export default function Jornada() {
  const queryClient = useQueryClient();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeTab, setActiveTab] = useState('controle');

  // Atualizar relógio a cada segundo
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Buscar último log de importação
  const { data: importLogs = [], refetch: refetchImportLogs } = useQuery({
    queryKey: ['importLogs'],
    queryFn: () => base44.entities.ImportLog.list('-imported_at', 1),
  });

  const lastImport = importLogs[0] || null;

  const [varreduraLoading, setVarreduraLoading] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStatus, setSyncStatus] = useState("");

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['veiculos'] });
    queryClient.invalidateQueries({ queryKey: ['macros'] });
  };

  const handleVarreduraCompleta = async () => {
    setVarreduraLoading(true);
    setSyncProgress(0);
    setSyncStatus("Iniciando...");
    
    const toastId = toast.loading('Iniciando sincronização completa...');
    
    try {
      // Passo 1: Sincronizar veículos
      setSyncStatus("Atualizando cadastro de veículos...");
      toast.loading('Sincronizando veículos...', { id: toastId });
      
      let vOffset = 0;
      let vRodadas = 0;
      while (vRodadas < 50) {
        const res = await base44.functions.invoke('autotracSyncVehicles', { offset: vOffset });
        const data = res.data;
        if (!data.success) throw new Error(data.error || 'Erro na sincronização de veículos');
        vOffset = data.next_offset;
        vRodadas++;
        if (data.concluido) break;
      }
      
      setSyncProgress(10); // 10% concluído após veículos

      // Passo 2: Sincronizar macros
      setSyncStatus("Baixando mensagens de cada veículo...");
      toast.loading('Sincronizando macros...', { id: toastId });
      
      let mOffset = 0;
      let mRodadas = 0;
      
      while (mRodadas < 100) { // Limite de segurança aumentado
        // Usar strategy='linear' para garantir varredura sequencial na UI
        const res = await base44.functions.invoke('autotracSyncMacros', { 
            veiculoOffset: mOffset,
            strategy: 'linear'
        });
        const data = res.data;
        if (!data.success) throw new Error(data.error || 'Erro na sincronização de macros');
        
        mOffset = data.proximo_offset;
        mRodadas++;
        
        // Atualiza progresso visual
        if (data.veiculos_total) {
          const processed = Math.min(mOffset || data.veiculos_total, data.veiculos_total);
          const percent = 10 + Math.floor((processed / data.veiculos_total) * 90);
          setSyncProgress(percent);
          setSyncStatus(`Processando veículos: ${processed} de ${data.veiculos_total}`);
          toast.loading(`Sincronizando macros: ${processed}/${data.veiculos_total} veículos`, { id: toastId });
        }
        
        if (data.concluido) break;
      }

      setSyncProgress(100);
      setSyncStatus("Concluído!");
      toast.success('Sincronização completa finalizada!', { id: toastId });
      
      queryClient.invalidateQueries({ queryKey: ['veiculos'] });
      queryClient.invalidateQueries({ queryKey: ['macros'] });
      refetchImportLogs();

    } catch (err) {
      toast.error('Erro na sincronização: ' + err.message, { id: toastId });
      setSyncStatus("Erro na execução");
    } finally {
      setVarreduraLoading(false);
      setTimeout(() => {
        setSyncProgress(0);
        setSyncStatus("");
      }, 5000);
    }
  };

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

              {/* Sincronização e Progresso */}
              <div className="flex flex-col items-end gap-1">
                <Button
                    onClick={handleVarreduraCompleta}
                    disabled={varreduraLoading}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 shadow-sm"
                >
                    {varreduraLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                    <Database className="w-4 h-4" />
                    )}
                    {varreduraLoading ? 'Sincronizando...' : 'Sincronizar Banco'}
                </Button>
                {varreduraLoading && (
                    <div className="w-40 space-y-1">
                        <Progress value={syncProgress} className="h-1.5" />
                        <p className="text-[10px] text-right text-slate-500 font-medium truncate">
                            {syncStatus}
                        </p>
                    </div>
                )}
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