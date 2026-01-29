import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';

export default function LimpezaDuplicatas() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const verificarDuplicatas = async () => {
    setLoading(true);
    setResult(null);
    
    try {
      const macros = await base44.entities.MacroEvento.list('-data_criacao', 50000);
      
      // Agrupar por chave única: veiculo_id + numero_macro + data_criacao
      const grupos = {};
      macros.forEach(m => {
        const key = `${m.veiculo_id}-${m.numero_macro}-${m.data_criacao}`;
        if (!grupos[key]) {
          grupos[key] = [];
        }
        grupos[key].push(m);
      });

      // Encontrar duplicatas
      const duplicatas = [];
      Object.entries(grupos).forEach(([key, items]) => {
        if (items.length > 1) {
          duplicatas.push({ key, items });
        }
      });

      setResult({
        total: macros.length,
        duplicatas: duplicatas.length,
        grupos: duplicatas
      });
    } catch (error) {
      console.error('Erro ao verificar duplicatas:', error);
      setResult({ error: 'Erro ao verificar duplicatas' });
    } finally {
      setLoading(false);
    }
  };

  const removerDuplicatas = async () => {
    if (!result || !result.grupos) return;
    
    setLoading(true);
    
    try {
      let removidos = 0;
      
      for (const grupo of result.grupos) {
        // Manter o primeiro (mais antigo ou editado manualmente), remover os demais
        const items = grupo.items.sort((a, b) => {
          // Priorizar editados manualmente
          if (a.editado_manualmente && !b.editado_manualmente) return -1;
          if (!a.editado_manualmente && b.editado_manualmente) return 1;
          // Senão, manter o mais antigo (created_date)
          return new Date(a.created_date) - new Date(b.created_date);
        });
        
        // Remover todos exceto o primeiro
        for (let i = 1; i < items.length; i++) {
          await base44.entities.MacroEvento.delete(items[i].id);
          removidos++;
        }
      }
      
      setResult({
        ...result,
        removidos,
        sucesso: true
      });
      
      // Recarregar dados
      setTimeout(() => verificarDuplicatas(), 1000);
    } catch (error) {
      console.error('Erro ao remover duplicatas:', error);
      setResult({ ...result, error: 'Erro ao remover duplicatas' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Limpeza de Duplicatas - MacroEvento
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              Esta ferramenta verifica e remove registros duplicados na tabela MacroEvento.
              Duplicatas são identificadas por: veículo + número da macro + data/hora exata.
            </p>

            <div className="flex gap-3">
              <Button 
                onClick={verificarDuplicatas} 
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {loading ? 'Verificando...' : 'Verificar Duplicatas'}
              </Button>
              
              {result && result.duplicatas > 0 && !result.sucesso && (
                <Button 
                  onClick={removerDuplicatas} 
                  disabled={loading}
                  variant="destructive"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Remover Duplicatas
                </Button>
              )}
            </div>

            {result && !result.error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                <div className="grid grid-cols-3 gap-4">
                  <Card className="bg-slate-50">
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold text-slate-700">{result.total}</div>
                      <div className="text-sm text-slate-500">Total de Registros</div>
                    </CardContent>
                  </Card>
                  
                  <Card className={result.duplicatas > 0 ? 'bg-amber-50' : 'bg-green-50'}>
                    <CardContent className="pt-6">
                      <div className={`text-2xl font-bold ${result.duplicatas > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                        {result.duplicatas}
                      </div>
                      <div className={`text-sm ${result.duplicatas > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                        Grupos Duplicados
                      </div>
                    </CardContent>
                  </Card>
                  
                  {result.removidos !== undefined && (
                    <Card className="bg-green-50">
                      <CardContent className="pt-6">
                        <div className="text-2xl font-bold text-green-600">{result.removidos}</div>
                        <div className="text-sm text-green-600">Removidos</div>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {result.sucesso && (
                  <div className="flex items-center gap-2 p-4 bg-green-50 text-green-700 rounded-lg">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-medium">Duplicatas removidas com sucesso!</span>
                  </div>
                )}

                {result.grupos && result.grupos.length > 0 && !result.sucesso && (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    <div className="text-sm font-medium text-slate-700">
                      Duplicatas Encontradas:
                    </div>
                    {result.grupos.slice(0, 20).map((grupo, idx) => (
                      <div key={idx} className="p-3 bg-white rounded-lg border text-xs">
                        <div className="font-mono text-slate-500 mb-2">{grupo.key}</div>
                        <div className="text-slate-600">
                          {grupo.items.length} registros duplicados
                        </div>
                      </div>
                    ))}
                    {result.grupos.length > 20 && (
                      <div className="text-xs text-slate-500 text-center pt-2">
                        ... e mais {result.grupos.length - 20} grupos
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {result && result.error && (
              <div className="flex items-center gap-2 p-4 bg-red-50 text-red-700 rounded-lg">
                <AlertTriangle className="w-5 h-5" />
                <span>{result.error}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}