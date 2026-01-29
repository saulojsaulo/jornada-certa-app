import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';

export default function ImportXLSX({ onImportComplete }) {
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState(null);
  const [stats, setStats] = useState({ total: 0, imported: 0, duplicates: 0, errors: 0 });
  const fileInputRef = useRef(null);

  const processFile = async (file) => {
    setIsImporting(true);
    setProgress(0);
    setStatus('Lendo arquivo...');
    setStats({ total: 0, imported: 0, duplicates: 0, errors: 0 });

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      // Pular cabeçalho
      const dataRows = rows.slice(1).filter(row => row.length >= 3);
      setStats(prev => ({ ...prev, total: dataRows.length }));
      setStatus('Processando registros...');

      // Buscar veículos existentes
      const existingVehicles = await base44.entities.Veiculo.list();
      const vehicleMap = {};
      existingVehicles.forEach(v => {
        vehicleMap[v.nome_veiculo.toLowerCase().trim()] = v.id;
      });

      // Buscar macros existentes para verificar duplicatas
      const existingMacros = await base44.entities.MacroEvento.list();
      const macroKeys = new Set(
        existingMacros.map(m => `${m.veiculo_id}-${m.numero_macro}-${m.data_criacao}`)
      );

      let imported = 0;
      let duplicates = 0;
      let errors = 0;

      // Ordenar por data de criação
      const sortedRows = dataRows.sort((a, b) => {
        const dateA = parseDate(a[2]);
        const dateB = parseDate(b[2]);
        return dateA - dateB;
      });

      // Processar em lotes
      const batchSize = 10;
      for (let i = 0; i < sortedRows.length; i += batchSize) {
        const batch = sortedRows.slice(i, i + batchSize);
        const toCreate = [];

        for (const row of batch) {
          try {
            const nomeVeiculo = String(row[0]).trim();
            const numeroMacro = parseInt(row[1]);
            const dataCriacao = parseDate(row[2]);

            if (!nomeVeiculo || isNaN(numeroMacro) || !dataCriacao) {
              errors++;
              continue;
            }

            // Criar veículo se não existir
            let veiculoId = vehicleMap[nomeVeiculo.toLowerCase()];
            if (!veiculoId) {
              const newVehicle = await base44.entities.Veiculo.create({
                nome_veiculo: nomeVeiculo
              });
              veiculoId = newVehicle.id;
              vehicleMap[nomeVeiculo.toLowerCase()] = veiculoId;
            }

            const dataReferencia = dataCriacao.toISOString().split('T')[0];
            const dataCriacaoStr = dataCriacao.toISOString();
            const key = `${veiculoId}-${numeroMacro}-${dataCriacaoStr}`;

            if (macroKeys.has(key)) {
              duplicates++;
              continue;
            }

            macroKeys.add(key);
            toCreate.push({
              veiculo_id: veiculoId,
              numero_macro: numeroMacro,
              data_criacao: dataCriacaoStr,
              data_referencia: dataReferencia
            });
          } catch (err) {
            errors++;
          }
        }

        // Criar em lote
        if (toCreate.length > 0) {
          await base44.entities.MacroEvento.bulkCreate(toCreate);
          imported += toCreate.length;
        }

        setProgress(Math.round(((i + batch.length) / sortedRows.length) * 100));
        setStats({ total: sortedRows.length, imported, duplicates, errors });
      }

      setStatus('complete');
      setStats({ total: sortedRows.length, imported, duplicates, errors });
      
      if (onImportComplete) {
        onImportComplete();
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
    <Card className="border-0 shadow-lg bg-white/80 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
          Importar Dados
        </CardTitle>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}