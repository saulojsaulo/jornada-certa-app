import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function DebugMacrosTab() {
  const [loading, setLoading] = useState(false);
  const [macros, setMacros] = useState([]);
  const [totalVehicles, setTotalVehicles] = useState(0);

  const handleFetchMacros = async () => {
    setLoading(true);
    try {
      const toastId = toast.loading('Buscando TODOS os 229 veículos e macros das últimas 48 horas...');
      
      const result = await base44.functions.invoke('autotracDebugAllMacros', {});
      
      if (result.data.success) {
        setMacros(result.data.macros || []);
        setTotalVehicles(result.data.total_vehicles);
        toast.success(`${result.data.total_macros} macros encontradas em ${result.data.total_vehicles} veículos!`, { id: toastId });
      } else {
        toast.error('Erro ao buscar macros: ' + result.data.error, { id: toastId });
      }
    } catch (error) {
      toast.error('Erro ao buscar macros: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-3">
        <Button 
          onClick={handleFetchMacros}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Buscar Macros (Últimas 24h)
        </Button>
      </div>

      {macros.length === 0 && !loading && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
          <AlertCircle className="w-5 h-5" />
          <span>Clique no botão acima para buscar TODAS as macros dos 229 veículos (últimas 48 horas)</span>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <span className="ml-3 text-slate-600">Buscando macros da API...</span>
        </div>
      )}

      {macros.length > 0 && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>{macros.length} macros</strong> encontradas da API Autotrac (últimas 24 horas)
            </p>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Veículo</th>
                  <th className="text-left px-4 py-2 font-semibold">Autotrac ID</th>
                  <th className="text-center px-4 py-2 font-semibold">Macro</th>
                  <th className="text-left px-4 py-2 font-semibold">Data/Hora</th>
                  <th className="text-left px-4 py-2 font-semibold">Dados Brutos</th>
                </tr>
              </thead>
              <tbody>
                {macros.map((macro, idx) => (
                  <tr key={idx} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium">{macro.veiculo_nome}</td>
                    <td className="px-4 py-2 text-slate-600">{macro.autotrac_id}</td>
                    <td className="px-4 py-2 text-center">
                      <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded font-semibold">
                        {macro.numero_macro}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {macro.data_criacao ? format(new Date(macro.data_criacao), 'dd/MM/yyyy HH:mm:ss', { locale: ptBR }) : 'N/A'}
                    </td>
                    <td className="px-4 py-2">
                      <details className="cursor-pointer">
                        <summary className="text-blue-600 hover:text-blue-700">Ver JSON</summary>
                        <pre className="mt-2 bg-slate-900 text-slate-100 p-2 rounded text-xs overflow-auto max-h-48">
                          {JSON.stringify(macro.raw, null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}