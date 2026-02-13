import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DRIVER_MAP } from '../jornada/DriverData';
import { Database, CheckCircle, AlertCircle } from 'lucide-react';

export default function MigrarDados() {
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const migrarDados = async () => {
    setLoading(true);
    setStatus('Iniciando migração...');

    try {
      // 1. Extrair motoristas únicos
      const motoristasUnicos = [...new Set(Object.values(DRIVER_MAP))].filter(nome => nome !== 'SEM MOTORISTA');
      setStatus(`Encontrados ${motoristasUnicos.length} motoristas únicos...`);

      // 2. Criar motoristas
      const motoristasData = motoristasUnicos.map(nome => ({
        nome,
        ativo: true
      }));

      await base44.entities.Motorista.bulkCreate(motoristasData);
      setStatus(`✓ ${motoristasUnicos.length} motoristas criados!`);

      // 3. Criar gestores
      const gestoresUnicos = [
        'Júnior',
        'Jackson',
        'Reginaldo',
        'Saulo',
        'Elinete',
        'Maickel',
        'Sérgio',
        'Michel',
        'Saulo 4º Eixo'
      ];

      const gestoresData = gestoresUnicos.map(nome => ({
        nome,
        ativo: true
      }));

      await base44.entities.Gestor.bulkCreate(gestoresData);
      setStatus(`✓ Migração concluída! ${motoristasUnicos.length} motoristas e ${gestoresUnicos.length} gestores criados com sucesso!`);

    } catch (error) {
      console.error('Erro na migração:', error);
      setStatus(`✗ Erro na migração: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6 bg-blue-50 border-blue-200">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
          <Database className="w-6 h-6 text-blue-600" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-slate-800 mb-2">
            Migração de Dados
          </h3>
          <p className="text-sm text-slate-600 mb-4">
            Importar motoristas e gestores já existentes no sistema para as novas tabelas de cadastro.
          </p>
          
          {status && (
            <div className={`mb-4 p-3 rounded-lg ${
              status.includes('✓') ? 'bg-green-100 text-green-800' :
              status.includes('✗') ? 'bg-red-100 text-red-800' :
              'bg-blue-100 text-blue-800'
            }`}>
              <div className="flex items-center gap-2">
                {status.includes('✓') && <CheckCircle className="w-4 h-4" />}
                {status.includes('✗') && <AlertCircle className="w-4 h-4" />}
                <span className="text-sm font-medium">{status}</span>
              </div>
            </div>
          )}

          <Button 
            onClick={migrarDados}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {loading ? 'Migrando...' : 'Iniciar Migração'}
          </Button>
        </div>
      </div>
    </Card>
  );
}