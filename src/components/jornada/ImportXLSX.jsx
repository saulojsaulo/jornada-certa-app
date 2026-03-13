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

export default function ImportXLSX({ onImportComplete, onImportLogUpdate, compact = false }) {
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

      // Buscar macros existentes para verificar duplicatas e editados manualmente
      setStatus('Verificando duplicatas...');
      const existingMacros = await base44.entities.MacroEvento.list('-data_criacao', 50000);
      
      // Primeiro, remover duplicatas existentes no banco
      const grupos = {};
      existingMacros.forEach(m => {
        const dateToSecond = new Date(m.data_criacao);
        dateToSecond.setMilliseconds(0);
        const key = `${m.veiculo_id}-${m.numero_macro}-${dateToSecond.toISOString()}`;
        if (!grupos[key]) {
          grupos[key] = [];
        }
        grupos[key].push(m);
      });
      
      // Identificar e remover duplicatas (mantendo o editado manualmente ou o mais antigo)
      let duplicatasRemovidas = 0;
      for (const [key, items] of Object.entries(grupos)) {
        if (items.length > 1) {
          items.sort((a, b) => {
            if (a.editado_manualmente && !b.editado_manualmente) return -1;
            if (!a.editado_manualmente && b.editado_manualmente) return 1;
            return new Date(a.created_date) - new Date(b.created_date);
          });
          
          for (let i = 1; i < items.length; i++) {
            await base44.entities.MacroEvento.delete(items[i].id);
            duplicatasRemovidas++;
          }
        }
      }
      
      if (duplicatasRemovidas > 0) {
        setStatus(`${duplicatasRemovidas} duplicatas removidas. Recarregando...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Recarregar macros após limpeza
      const cleanMacros = await base44.entities.MacroEvento.list('-data_criacao', 50000);
      const macroKeys = new Map();
      const editedKeys = new Set();
      cleanMacros.forEach(m => {
        const dateToSecond = new Date(m.data_criacao);
        dateToSecond.setMilliseconds(0);
        const key = `${m.veiculo_id}-${m.numero_macro}-${dateToSecond.toISOString()}`;
        macroKeys.set(key, true);
        if (m.editado_manualmente) {
          editedKeys.add(key);
        }
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

      // Ordenar por veículo e data para processar jornadas logicamente
      validRows.sort((a, b) => {
        const vComp = a.nomeVeiculo.localeCompare(b.nomeVeiculo);
        if (vComp !== 0) return vComp;
        return a.dataCriacao - b.dataCriacao;
      });

      // Calcular jornada_id para cada macro
      setStatus('Calculando jornadas lógicas...');
      const rowsWithJornada = [];
      const jornadaPorVeiculo = new Map(); // veiculoId -> { jornadaId, dataJornada, aberta }
      
      for (const row of validRows) {
        const veiculoId = vehicleMap.get(row.nomeVeiculo.toLowerCase());
        let jornadaAtual = jornadaPorVeiculo.get(veiculoId);
        
        // Macro 1 sempre inicia nova jornada
        if (row.numeroMacro === 1) {
          const dataJornada = row.dataCriacao.toISOString().split('T')[0];
          const jornadaId = `${veiculoId}-${dataJornada}-${row.dataCriacao.getTime()}`;
          jornadaAtual = { jornadaId, dataJornada, aberta: true };
          jornadaPorVeiculo.set(veiculoId, jornadaAtual);
        }
        
        // Macro 2 encerra a jornada
        if (row.numeroMacro === 2 && jornadaAtual) {
          jornadaAtual.aberta = false;
        }
        
        // Atribuir jornada_id e data_jornada
        if (jornadaAtual && jornadaAtual.aberta) {
          rowsWithJornada.push({
            ...row,
            veiculoId,
            jornadaId: jornadaAtual.jornadaId,
            dataJornada: jornadaAtual.dataJornada
          });
        } else {
          // Macros órfãs (sem Macro 1 aberta) não têm jornada
          rowsWithJornada.push({
            ...row,
            veiculoId,
            jornadaId: null,
            dataJornada: null
          });
        }
      }

      // Processar em lotes
      const batchSize = 500;
      const totalBatches = Math.ceil(rowsWithJornada.length / batchSize);
      
      for (let i = 0; i < rowsWithJornada.length; i += batchSize) {
        const currentBatch = Math.floor(i / batchSize) + 1;
        setStatus(`Processando lote ${currentBatch}/${totalBatches}...`);
        
        const batch = rowsWithJornada.slice(i, i + batchSize);
        const toCreate = [];

        for (const row of batch) {
          const dataCriacaoStr = row.dataCriacao.toISOString();
          
          // Criar chave única (sem milissegundos)
          const dateToSecond = new Date(row.dataCriacao);
          dateToSecond.setMilliseconds(0);
          const key = `${row.veiculoId}-${row.numeroMacro}-${dateToSecond.toISOString()}`;

          // Ignorar se foi editado manualmente ou já existe
          if (editedKeys.has(key) || macroKeys.has(key)) {
            duplicates++;
            continue;
          }

          macroKeys.set(key, true);
          toCreate.push({
            veiculo_id: row.veiculoId,
            numero_macro: row.numeroMacro,
            data_criacao: dataCriacaoStr,
            jornada_id: row.jornadaId,
            data_jornada: row.dataJornada
          });
        }

        // Criar em lote
        if (toCreate.length > 0) {
          await base44.entities.MacroEvento.bulkCreate(toCreate);
          imported += toCreate.length;
        }

        // Atualizar progresso
        const progressPercent = Math.round(((i + batch.length) / rowsWithJornada.length) * 100);
        setProgress(progressPercent);
        setStats({ total: dataRows.length, imported, duplicates, errors });

        if (i + batchSize < rowsWithJornada.length) {
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
    
    if (typeof value === 'number') {
      const date = XLSX.SSF.parse_date_code(value);
      return new Date(date.y, date.m - 1, date.d, date.H || 0, date.M || 0, date.S || 0);
    }
    
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed;
    
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
        <Button
          className={compact ? "h-9 w-9 bg-emerald-600 hover:bg-emerald-700" : "bg-emerald-600 hover:bg-emerald-700 shadow-lg"}
          size={compact ? "icon" : "default"}
          title="Importar Dados"
        >
          <Upload className="w-4 h-4" />
          {!compact && 'Importar Dados'}
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