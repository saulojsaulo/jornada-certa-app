import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function ImportXLSX({ onImportComplete, onImportLogUpdate }) {
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState(null);
  const [stats, setStats] = useState({ total: 0, imported: 0, duplicates: 0, errors: 0 });
  const fileInputRef = useRef(null);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const user = await base44.auth.me();
        setCurrentUser(user);
      } catch (e) {
        console.log('User not logged in');
      }
    };
    loadUser();
  }, []);

  const processFile = async (file) => {
    setIsImporting(true);
    setProgress(0);
    setStatus('Lendo arquivo...');
    setStats({ total: 0, imported: 0, duplicates: 0, errors: 0 });

    try {
      // Ler arquivo
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      // Pular cabeçalho e filtrar linhas vazias
      const dataRows = rows.slice(1).filter(row => row && row.length >= 3 && row[0]);
      
      if (dataRows.length === 0) {
        throw new Error('Nenhum dado válido encontrado no arquivo');
      }

      setStats(prev => ({ ...prev, total: dataRows.length }));
      setStatus(`Carregando dados existentes...`);

      // Buscar veículos existentes
      const existingVehicles = await base44.entities.Veiculo.list();
      const vehicleMap = new Map();
      existingVehicles.forEach(v => {
        vehicleMap.set(v.nome_veiculo.toLowerCase().trim(), v.id);
      });

      // Buscar macros existentes para verificar duplicatas (usar Map para performance)
      setStatus('Verificando duplicatas...');
      const existingMacros = await base44.entities.MacroEvento.list('-data_criacao', 50000);
      const macroKeys = new Map();
      existingMacros.forEach(m => {
        macroKeys.set(`${m.veiculo_id}-${m.numero_macro}-${m.data_criacao}`, true);
      });

      let imported = 0;
      let duplicates = 0;
      let errors = 0;

      // Pré-processar e validar todas as linhas
      setStatus('Validando registros...');
      const validRows = [];
      const newVehicles = new Map();

      for (const row of dataRows) {
        try {
          const nomeVeiculo = String(row[0]).trim();
          const numeroMacro = parseInt(row[1]);
          const dataCriacao = parseDate(row[2]);

          if (!nomeVeiculo || isNaN(numeroMacro) || !dataCriacao) {
            errors++;
            continue;
          }

          validRows.push({ nomeVeiculo, numeroMacro, dataCriacao });
          
          // Identificar veículos novos
          const vehicleKey = nomeVeiculo.toLowerCase();
          if (!vehicleMap.has(vehicleKey) && !newVehicles.has(vehicleKey)) {
            newVehicles.set(vehicleKey, nomeVeiculo);
          }
        } catch (err) {
          errors++;
        }
      }

      // Criar todos os veículos novos de uma vez
      if (newVehicles.size > 0) {
        setStatus(`Criando ${newVehicles.size} veículos novos...`);
        const vehiclesToCreate = Array.from(newVehicles.values()).map(nome => ({
          nome_veiculo: nome
        }));
        
        const createdVehicles = await base44.entities.Veiculo.bulkCreate(vehiclesToCreate);
        createdVehicles.forEach(v => {
          vehicleMap.set(v.nome_veiculo.toLowerCase().trim(), v.id);
        });
      }

      // Ordenar por data
      validRows.sort((a, b) => a.dataCriacao - b.dataCriacao);

      // Processar em lotes maiores
      const batchSize = 500;
      const totalBatches = Math.ceil(validRows.length / batchSize);
      
      for (let i = 0; i < validRows.length; i += batchSize) {
        const currentBatch = Math.floor(i / batchSize) + 1;
        setStatus(`Processando lote ${currentBatch}/${totalBatches}...`);
        
        const batch = validRows.slice(i, i + batchSize);
        const toCreate = [];

        for (const row of batch) {
          const veiculoId = vehicleMap.get(row.nomeVeiculo.toLowerCase());
          const dataReferencia = row.dataCriacao.toISOString().split('T')[0];
          const dataCriacaoStr = row.dataCriacao.toISOString();
          const key = `${veiculoId}-${row.numeroMacro}-${dataCriacaoStr}`;

          if (macroKeys.has(key)) {
            duplicates++;
            continue;
          }

          macroKeys.set(key, true);
          toCreate.push({
            veiculo_id: veiculoId,
            numero_macro: row.numeroMacro,
            data_criacao: dataCriacaoStr,
            data_referencia: dataReferencia
          });
        }

        // Criar em lote
        if (toCreate.length > 0) {
          await base44.entities.MacroEvento.bulkCreate(toCreate);
          imported += toCreate.length;
        }

        // Atualizar progresso
        const progressPercent = Math.round(((i + batch.length) / validRows.length) * 100);
        setProgress(progressPercent);
        setStats({ total: dataRows.length, imported, duplicates, errors });

        // Pequena pausa para não sobrecarregar
        if (i + batchSize < validRows.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      setStatus('Finalizando...');
      setStats({ total: dataRows.length, imported, duplicates, errors });

      // Registrar log de importação
      const userName = currentUser?.full_name || currentUser?.email || 'Usuário';
      await base44.entities.ImportLog.create({
        imported_at: new Date().toISOString(),
        imported_by: userName,
        records_count: imported
      });

      setStatus('complete');

      if (onImportComplete) {
        onImportComplete();
      }
      if (onImportLogUpdate) {
        onImportLogUpdate();
      }
    } catch (error) {
      console.error('Erro na importação:', error);
      setStatus('error');
    } finally {
      setIsImporting(false);
    }
  };

  const parseDate = (value) => {
    if (!value) return null;
    
    // Se for número (Excel serial date)
    if (typeof value === 'number') {
      const date = XLSX.SSF.parse_date_code(value);
      return new Date(date.y, date.m - 1, date.d, date.H || 0, date.M || 0, date.S || 0);
    }
    
    // Se for string, tentar parsear
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed;
    
    // Tentar formato DD/MM/YYYY HH:mm:ss
    const match = String(value).match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):?(\d{2})?/);
    if (match) {
      return new Date(
        parseInt(match[3]),
        parseInt(match[2]) - 1,
        parseInt(match[1]),
        parseInt(match[4]),
        parseInt(match[5]),
        parseInt(match[6] || 0)
      );
    }
    
    return null;
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      processFile(file);
    }
  };

  const reset = () => {
    setStatus(null);
    setProgress(0);
    setStats({ total: 0, imported: 0, duplicates: 0, errors: 0 });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="bg-emerald-600 hover:bg-emerald-700 shadow-lg">
          <Upload className="w-4 h-4 mr-2" />
          Importar Dados
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            Importar Planilha XLSX
          </DialogTitle>
        </DialogHeader>
        <div className="mt-4">
        <AnimatePresence mode="wait">
          {!isImporting && !status && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center hover:border-emerald-400 transition-colors cursor-pointer"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3" />
              <p className="text-sm text-slate-600 mb-1">
                Arraste um arquivo XLSX ou clique para selecionar
              </p>
              <p className="text-xs text-slate-400">
                Colunas: Nome do Veículo | Número da Macro | Data de Criação
              </p>
            </motion.div>
          )}

          {isImporting && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">{status}</span>
                <span className="font-medium">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="p-2 bg-slate-50 rounded-lg">
                  <div className="font-semibold text-slate-700">{stats.total}</div>
                  <div className="text-slate-500">Total</div>
                </div>
                <div className="p-2 bg-emerald-50 rounded-lg">
                  <div className="font-semibold text-emerald-700">{stats.imported}</div>
                  <div className="text-emerald-600">Importados</div>
                </div>
                <div className="p-2 bg-amber-50 rounded-lg">
                  <div className="font-semibold text-amber-700">{stats.duplicates}</div>
                  <div className="text-amber-600">Duplicados</div>
                </div>
                <div className="p-2 bg-red-50 rounded-lg">
                  <div className="font-semibold text-red-700">{stats.errors}</div>
                  <div className="text-red-600">Erros</div>
                </div>
              </div>
            </motion.div>
          )}

          {status === 'complete' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="text-center space-y-4"
            >
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
              <div>
                <p className="font-medium text-slate-700">Importação Concluída!</p>
                <p className="text-sm text-slate-500">
                  {stats.imported} registros importados
                  {stats.duplicates > 0 && `, ${stats.duplicates} duplicados ignorados`}
                </p>
              </div>
              <Button onClick={reset} variant="outline" size="sm">
                Nova Importação
              </Button>
            </motion.div>
          )}

          {status === 'error' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center space-y-4"
            >
              <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
              <div>
                <p className="font-medium text-slate-700">Erro na Importação</p>
                <p className="text-sm text-slate-500">
                  Verifique o formato do arquivo e tente novamente
                </p>
              </div>
              <Button onClick={reset} variant="outline" size="sm">
                Tentar Novamente
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}