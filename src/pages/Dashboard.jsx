import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek } from 'date-fns';
import { Calendar as CalendarIcon, TrendingUp, Clock, AlertTriangle, Users, Car } from 'lucide-react';
import { cn } from '@/lib/utils';

// UI Components
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// Utils
import { 
  minutesToHHMM, 
  calcularJornadaLiquida, 
  calcularHorasExtras,
  calcularInterjornada,
  verificarAlertaRefeicao,
  verificarAlertasInterjornada,
  getVehicleStatus,
  STATUS_CONFIG
} from '../components/jornada/MacroUtils';
import { getDriverName, extractFleetNumber } from '../components/jornada/DriverData';

export default function Dashboard() {
  const [dateRange, setDateRange] = useState({
    from: subDays(new Date(), 6),
    to: new Date(),
  });
  const [selectedRangeType, setSelectedRangeType] = useState('last7days');

  // Ajustar dateRange baseado no tipo selecionado
  const handleRangeTypeChange = (type) => {
    setSelectedRangeType(type);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    let newFrom, newTo;

    if (type === 'today') {
      newFrom = new Date(today);
      newFrom.setHours(0, 0, 0, 0);
      newTo = today;
    } else if (type === 'yesterday') {
      newFrom = subDays(today, 1);
      newFrom.setHours(0, 0, 0, 0);
      newTo = subDays(today, 1);
      newTo.setHours(23, 59, 59, 999);
    } else if (type === 'last7days') {
      newFrom = subDays(today, 6);
      newFrom.setHours(0, 0, 0, 0);
      newTo = today;
    } else if (type === 'last30days') {
      newFrom = subDays(today, 29);
      newFrom.setHours(0, 0, 0, 0);
      newTo = today;
    } else if (type === 'thismonth') {
      newFrom = startOfMonth(today);
      newTo = endOfMonth(today);
    } else if (type === 'lastmonth') {
      const lastMonth = subMonths(today, 1);
      newFrom = startOfMonth(lastMonth);
      newTo = endOfMonth(lastMonth);
    }
    
    setDateRange({ from: newFrom, to: newTo });
  };

  const fromDateFormatted = dateRange.from ? format(dateRange.from, 'dd/MM/yyyy') : '';
  const toDateFormatted = dateRange.to ? format(dateRange.to, 'dd/MM/yyyy') : '';

  // Fetch data
  const { data: veiculos = [], isLoading: isLoadingVehicles } = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => base44.entities.Veiculo.list(),
  });

  const { data: macroEvents = [], isLoading: isLoadingMacros } = useQuery({
    queryKey: ['macroEvents'],
    queryFn: async () => base44.entities.MacroEvento.list(),
  });

  // Processar dados
  const dashboardData = useMemo(() => {
    if (!macroEvents.length || !veiculos.length) {
      return {
        totalHorasExtras: 0,
        mediaInterjornada: 0,
        alertasRefeicao: [],
        alertasInterjornada11h: [],
        alertasInterjornada8h: [],
        statusVeiculos: {},
        jornadasPorDia: {}
      };
    }

    // Filtrar macros no período
    const macrosNoPeriodo = macroEvents.filter(m => {
      const dataJornada = new Date(m.data_jornada);
      return dataJornada >= dateRange.from && dataJornada <= dateRange.to && !m.excluido;
    });

    // Agrupar por jornada_id
    const jornadasMap = {};
    macrosNoPeriodo.forEach(m => {
      if (!jornadasMap[m.jornada_id]) {
        jornadasMap[m.jornada_id] = [];
      }
      jornadasMap[m.jornada_id].push(m);
    });

    let totalHorasExtras = 0;
    let totalInterjornada = 0;
    let countInterjornada = 0;
    const alertasRefeicao = [];
    const alertasInterjornada11h = [];
    const alertasInterjornada8h = [];
    const statusVeiculos = {};

    // Processar cada jornada
    Object.entries(jornadasMap).forEach(([jornadaId, macros]) => {
      const macrosOrdenadas = [...macros].sort((a, b) => new Date(a.data_criacao) - new Date(b.data_criacao));
      const veiculoId = macrosOrdenadas[0]?.veiculo_id;
      const veiculo = veiculos.find(v => v.id === veiculoId);
      
      if (!veiculo) return;

      const horasExtras = calcularHorasExtras(macrosOrdenadas);
      totalHorasExtras += horasExtras;

      // Verificar alerta de refeição
      const alertaRefeicao = verificarAlertaRefeicao(macrosOrdenadas);
      if (alertaRefeicao) {
        alertasRefeicao.push({
          veiculo: veiculo.nome_veiculo,
          data: macrosOrdenadas[0].data_jornada,
          jornadaId
        });
      }

      // Calcular interjornada
      const dataJornadaAtual = macrosOrdenadas[0].data_jornada;
      const dataAnterior = new Date(dataJornadaAtual);
      dataAnterior.setDate(dataAnterior.getDate() - 1);
      const dataAnteriorStr = dataAnterior.toISOString().split('T')[0];
      
      const macrosOntem = macroEvents.filter(m => 
        m.veiculo_id === veiculoId && 
        m.data_jornada === dataAnteriorStr &&
        !m.excluido
      );

      const interjornada = calcularInterjornada(macrosOrdenadas, macrosOntem);
      if (interjornada > 0) {
        totalInterjornada += interjornada;
        countInterjornada++;

        const alertas = verificarAlertasInterjornada(interjornada, macrosOrdenadas);
        if (alertas.alerta11h && !alertas.alerta8h) {
          alertasInterjornada11h.push({
            veiculo: veiculo.nome_veiculo,
            data: dataJornadaAtual,
            interjornada,
            jornadaId
          });
        }
        if (alertas.alerta8h) {
          alertasInterjornada8h.push({
            veiculo: veiculo.nome_veiculo,
            data: dataJornadaAtual,
            interjornada,
            jornadaId
          });
        }
      }

      // Status atual (última data)
      const ultimaData = format(dateRange.to, 'yyyy-MM-dd');
      if (macrosOrdenadas[0].data_jornada === ultimaData) {
        const status = getVehicleStatus(macrosOrdenadas);
        if (!statusVeiculos[status]) {
          statusVeiculos[status] = 0;
        }
        statusVeiculos[status]++;
      }
    });

    return {
      totalHorasExtras,
      mediaInterjornada: countInterjornada > 0 ? totalInterjornada / countInterjornada : 0,
      alertasRefeicao,
      alertasInterjornada11h,
      alertasInterjornada8h,
      statusVeiculos,
      totalJornadas: Object.keys(jornadasMap).length
    };
  }, [macroEvents, veiculos, dateRange]);

  const isLoading = isLoadingVehicles || isLoadingMacros;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-6 space-y-6"
    >
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-800">Dashboard de Jornada</h1>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Período de Análise</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <Select value={selectedRangeType} onValueChange={handleRangeTypeChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione um período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="yesterday">Ontem</SelectItem>
                <SelectItem value="last7days">Últimos 7 dias</SelectItem>
                <SelectItem value="last30days">Últimos 30 dias</SelectItem>
                <SelectItem value="thismonth">Este Mês</SelectItem>
                <SelectItem value="lastmonth">Mês Passado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !dateRange.from && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange.from ? (
                    dateRange.to ? (
                      <>
                        {fromDateFormatted} - {toDateFormatted}
                      </>
                    ) : (
                      fromDateFormatted
                    )
                  ) : (
                    <span>Selecione as datas</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange.from}
                  selected={dateRange}
                  onSelect={(range) => {
                    if (range?.from || range?.to) {
                      setDateRange(range);
                      setSelectedRangeType('custom');
                    }
                  }}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="text-center py-12 text-slate-400">Carregando dados...</div>
      ) : (
        <>
          {/* Métricas principais */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Horas Extras</CardTitle>
                <TrendingUp className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-red-600">
                  {minutesToHHMM(dashboardData.totalHorasExtras)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {dashboardData.totalJornadas} jornadas analisadas
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Média Interjornada</CardTitle>
                <Clock className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-600">
                  {minutesToHHMM(Math.round(dashboardData.mediaInterjornada))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Entre jornadas consecutivas
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total de Alertas</CardTitle>
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-amber-600">
                  {dashboardData.alertasRefeicao.length + 
                   dashboardData.alertasInterjornada11h.length + 
                   dashboardData.alertasInterjornada8h.length}
                </div>
                <div className="flex gap-2 mt-2 text-xs">
                  <span className="text-amber-600">🍽️ {dashboardData.alertasRefeicao.length}</span>
                  <span className="text-indigo-600">🌙 {dashboardData.alertasInterjornada11h.length}</span>
                  <span className="text-red-600">💣 {dashboardData.alertasInterjornada8h.length}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Status dos Veículos */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Car className="h-5 w-5" />
                Status Atual dos Veículos ({format(dateRange.to, 'dd/MM/yyyy')})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {Object.entries(dashboardData.statusVeiculos).length > 0 ? (
                  Object.entries(dashboardData.statusVeiculos).map(([status, count]) => {
                    const config = STATUS_CONFIG[status] || STATUS_CONFIG['Sem Jornada'];
                    return (
                      <Badge key={status} className={`${config.color} text-sm px-3 py-1`}>
                        {status}: {count}
                      </Badge>
                    );
                  })
                ) : (
                  <p className="text-slate-400">Nenhum veículo em jornada na última data selecionada</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Alertas Detalhados */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Alertas de Refeição */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  🍽️ Alertas de Refeição
                  <Badge variant="outline">{dashboardData.alertasRefeicao.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dashboardData.alertasRefeicao.length > 0 ? (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {dashboardData.alertasRefeicao.map((alerta, idx) => (
                      <div key={idx} className="p-2 bg-amber-50 rounded-lg border border-amber-200">
                        <div className="font-medium text-sm text-slate-700">
                          {extractFleetNumber(alerta.veiculo)} - {getDriverName(alerta.veiculo)}
                        </div>
                        <div className="text-xs text-slate-500">
                          {format(new Date(alerta.data), 'dd/MM/yyyy')}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">Nenhum alerta de refeição</p>
                )}
              </CardContent>
            </Card>

            {/* Alertas Interjornada < 11h */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  🌙 Interjornada {'<'} 11h
                  <Badge variant="outline">{dashboardData.alertasInterjornada11h.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dashboardData.alertasInterjornada11h.length > 0 ? (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {dashboardData.alertasInterjornada11h.map((alerta, idx) => (
                      <div key={idx} className="p-2 bg-indigo-50 rounded-lg border border-indigo-200">
                        <div className="font-medium text-sm text-slate-700">
                          {extractFleetNumber(alerta.veiculo)} - {getDriverName(alerta.veiculo)}
                        </div>
                        <div className="text-xs text-slate-500">
                          {format(new Date(alerta.data), 'dd/MM/yyyy')} - {minutesToHHMM(alerta.interjornada)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">Nenhum alerta de interjornada</p>
                )}
              </CardContent>
            </Card>

            {/* Alertas Interjornada < 8h */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  💣 Interjornada {'<'} 8h
                  <Badge variant="outline">{dashboardData.alertasInterjornada8h.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dashboardData.alertasInterjornada8h.length > 0 ? (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {dashboardData.alertasInterjornada8h.map((alerta, idx) => (
                      <div key={idx} className="p-2 bg-red-50 rounded-lg border border-red-200">
                        <div className="font-medium text-sm text-slate-700">
                          {extractFleetNumber(alerta.veiculo)} - {getDriverName(alerta.veiculo)}
                        </div>
                        <div className="text-xs text-slate-500">
                          {format(new Date(alerta.data), 'dd/MM/yyyy')} - {minutesToHHMM(alerta.interjornada)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">Nenhum alerta crítico</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </motion.div>
  );
}