import React, { useState, useMemo, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { Calendar, Loader2, AlertCircle } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from "sonner";

import StatsCards from './StatsCards';
import VehicleGrid from './VehicleGrid';

export default function AutotracDirectTab() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [veiculos, setVeiculos] = useState([]);
  const [macros, setMacros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncInProgress, setSyncInProgress] = useState(false);

  // Carregar veículos direto da Autotrac (sem usar banco de dados)
  useEffect(() => {
    const fetchVehiclesFromAutotrac = async () => {
      try {
        setLoading(true);
        const result = await base44.functions.invoke('autotracGetAllVehicles', {});
        
        if (result.data.success && result.data.vehicles && result.data.vehicles.length > 0) {
          setVeiculos(result.data.vehicles);
        } else {
          toast.error('Nenhum veículo encontrado na API Autotrac');
        }
      } catch (error) {
        toast.error('Erro ao carregar veículos: ' + error.message);
      } finally {
        setLoading(false);
      }
    };

    fetchVehiclesFromAutotrac();
  }, []);

  const motoristas = [];
  const gestores = [];

  const dateString = format(selectedDate, 'yyyy-MM-dd');

  // Processar macros para calcular jornadas
  const { macrosPorVeiculo, jornadas } = useMemo(() => {
    const macroMap = {};
    const jornadasList = [];

    // Agrupar macros por veículo e data
    macros.forEach(m => {
      if (!m.veiculo_code) return;
      
      const dataJornada = new Date(m.data_criacao).toISOString().split('T')[0];
      const key = `${m.veiculo_code}-${dataJornada}`;
      
      if (!macroMap[key]) {
        macroMap[key] = {
          veiculo_code: m.veiculo_code,
          veiculo_nome: m.veiculo_nome,
          placa: m.placa,
          data: dataJornada,
          macros: []
        };
      }
      macroMap[key].macros.push({
        numero: m.numero_macro,
        data_criacao: m.data_criacao
      });
    });

    // Calcular jornadas: Macro 1 = início, outras macros = eventos dentro da jornada
    Object.values(macroMap).forEach(item => {
      const macrosOrdenadas = item.macros.sort((a, b) => 
        new Date(a.data_criacao) - new Date(b.data_criacao)
      );
      
      const macro1 = macrosOrdenadas.find(m => m.numero === 1);
      if (macro1) {
        const ultimaMacro = macrosOrdenadas[macrosOrdenadas.length - 1];
        jornadasList.push({
          veiculo_code: item.veiculo_code,
          veiculo_nome: item.veiculo_nome,
          placa: item.placa,
          data_jornada: item.data,
          data_inicio: macro1.data_criacao,
          data_fim: ultimaMacro.data_criacao,
          total_macros: item.macros.length,
          macros: macrosOrdenadas
        });
      }
    });

    // Separar por dia
    const mapa = {};
    jornadasList
      .filter(j => j.data_jornada === dateString)
      .forEach(j => {
        if (!mapa[j.veiculo_code]) mapa[j.veiculo_code] = [];
        mapa[j.veiculo_code].push(j);
      });

    return { macrosPorVeiculo: mapa, jornadas: jornadasList };
  }, [macros, dateString]);

  const handleSyncFromAutotrac = async () => {
    setSyncInProgress(true);
    try {
      const toastId = toast.loading('Buscando macros de todas as 229 veículos (últimas 48h)...');
      
      const result = await base44.functions.invoke('autotracDebugAllMacros', {});
      
      if (result.data.success) {
        // Usar as macros direto da API
        setMacros(result.data.macros || []);
        toast.success(`${result.data.total_macros} macros carregadas de ${result.data.total_vehicles} veículos!`, { id: toastId });
      } else {
        toast.error('Erro ao buscar macros', { id: toastId });
      }
    } catch (error) {
      toast.error('Erro na sincronização: ' + error.message);
    } finally {
      setSyncInProgress(false);
    }
  };

  // Carregar macros ao inicializar
  useEffect(() => {
    const fetchMacros = async () => {
      try {
        const result = await base44.functions.invoke('autotracDebugAllMacros', {});
        if (result.data.success) {
          setMacros(result.data.macros || []);
        }
      } catch (error) {
        console.error('Erro ao carregar macros:', error);
      }
    };
    
    fetchMacros();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        <span className="ml-3 text-slate-600">Carregando veículos da Autotrac...</span>
      </div>
    );
  }

  if (veiculos.length === 0) {
    return (
      <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
        <AlertCircle className="w-5 h-5" />
        <span>Nenhum veículo encontrado na API Autotrac</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Controles */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button 
          onClick={handleSyncFromAutotrac}
          disabled={syncInProgress}
          className="bg-emerald-600 hover:bg-emerald-700 gap-2"
        >
          {syncInProgress ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : null}
          Sincronizar com Autotrac
        </Button>
        
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Calendar className="w-4 h-4" />
              {format(selectedDate, 'dd/MM/yyyy', { locale: ptBR })}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <CalendarComponent
              mode="single"
              selected={selectedDate}
              onSelect={(date) => date && setSelectedDate(date)}
              locale={ptBR}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Info */}
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <strong>{veiculos.length} veículos</strong> carregados direto da Autotrac (sem usar banco de dados)
      </div>

      {/* Jornadas Calculadas */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-slate-800">Jornadas ({jornadas.length})</h3>
        
        {jornadas.length === 0 ? (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-center text-slate-600">
            Nenhuma jornada encontrada para {format(selectedDate, 'dd/MM/yyyy', { locale: ptBR })}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid gap-3"
          >
            {jornadas.map((jornada, idx) => (
              <div key={idx} className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-slate-500 uppercase">Veículo</p>
                    <p className="font-semibold text-slate-900">{jornada.veiculo_nome}</p>
                    <p className="text-sm text-slate-600">{jornada.placa}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase">Horário</p>
                    <p className="font-semibold text-slate-900">
                      {format(new Date(jornada.data_inicio), 'HH:mm:ss', { locale: ptBR })}
                    </p>
                    <p className="text-sm text-slate-600">
                      até {format(new Date(jornada.data_fim), 'HH:mm:ss', { locale: ptBR })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase">Macros</p>
                    <p className="font-semibold text-slate-900">{jornada.total_macros} eventos</p>
                    <p className="text-sm text-slate-600">
                      {jornada.macros.map(m => m.numero).join(', ')}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}