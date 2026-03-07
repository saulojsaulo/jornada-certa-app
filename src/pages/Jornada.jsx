import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Clock, TrendingUp, UserSearch, Truck } from 'lucide-react';
import { Button } from "@/components/ui/button";
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

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['veiculos'] });
    queryClient.invalidateQueries({ queryKey: ['macros'] });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50">
      {/* Sub-header da página */}
      <div className="bg-white border-b border-slate-200 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {lastImport && (
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-600 bg-slate-50 rounded-lg border border-slate-200">
                <Clock className="w-3 h-3 text-slate-400" />
                <span>Última Importação: {format(new Date(lastImport.imported_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</span>
              </div>
            )}
            <div className="hidden md:flex items-center gap-1 bg-slate-100 rounded-lg px-3 py-1.5">
              <span className="text-sm font-mono font-bold text-slate-700">{format(currentTime, 'HH:mm:ss')}</span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
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
      </div>
    </div>
  );
}