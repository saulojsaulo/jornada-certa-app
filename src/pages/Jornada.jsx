import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import ControleTab from '../components/jornada/ControleTab';
import RankingTab from '../components/jornada/RankingTab';
import FiltroMotoristaTab from '../components/jornada/FiltroMotoristaTab';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-700 mb-2">Erro ao carregar a página</h2>
          <p className="text-sm text-red-600 font-mono bg-red-50 p-3 rounded">{this.state.error.message}</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>Recarregar</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Jornada() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('controle');

  // Buscar último log de importação
  const { data: importLogs = [], refetch: refetchImportLogs } = useQuery({
    queryKey: ['importLogs'],
    queryFn: () => base44.entities.ImportLog.list('-imported_at', 1),
  });

  const lastImport = importLogs[0] || null;


  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50">
      {/* Sub-header da página */}
      <div className="bg-white border-b border-slate-200 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {lastImport && (
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-600 bg-slate-50 rounded-lg border border-slate-200">
                <span>Última Importação: {format(new Date(lastImport.imported_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="hidden">
            <TabsTrigger value="controle" />
            <TabsTrigger value="ranking" />
            <TabsTrigger value="filtro" />
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
    </ErrorBoundary>
  );
}