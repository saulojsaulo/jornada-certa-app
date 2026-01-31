import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Trophy, TrendingUp, AlertTriangle } from 'lucide-react';
import { calcularJornadaLiquida, calcularHorasExtras, minutesToHHMM } from './MacroUtils';
import { getDriverName, getManagerName, extractFleetNumber } from './DriverData';

export default function RankingTab() {
  // Calcular mês atual por padrão
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  
  const [periodoPreset, setPeriodoPreset] = useState('mes_atual');
  const [dataInicio, setDataInicio] = useState(firstDayOfMonth);
  const [dataFim, setDataFim] = useState(lastDayOfMonth);
  const [mesEscolhido, setMesEscolhido] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [gestorFiltro, setGestorFiltro] = useState('all');
  const [veiculoFiltro, setVeiculoFiltro] = useState('all');
  
  // Atualizar datas quando o preset mudar
  const handlePresetChange = (preset) => {
    setPeriodoPreset(preset);
    const today = new Date();
    
    switch(preset) {
      case 'dia_anterior':
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        setDataInicio(yesterdayStr);
        setDataFim(yesterdayStr);
        break;
        
      case 'ultimos_7':
        const last7 = new Date(today);
        last7.setDate(last7.getDate() - 7);
        setDataInicio(last7.toISOString().split('T')[0]);
        setDataFim(today.toISOString().split('T')[0]);
        break;
        
      case 'ultimos_15':
        const last15 = new Date(today);
        last15.setDate(last15.getDate() - 15);
        setDataInicio(last15.toISOString().split('T')[0]);
        setDataFim(today.toISOString().split('T')[0]);
        break;
        
      case 'mes_atual':
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
        setDataInicio(firstDay);
        setDataFim(lastDay);
        break;
        
      case 'escolher_mes':
        // Mantém mesEscolhido atual
        const [year, month] = mesEscolhido.split('-');
        const firstDayMes = new Date(parseInt(year), parseInt(month) - 1, 1).toISOString().split('T')[0];
        const lastDayMes = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];
        setDataInicio(firstDayMes);
        setDataFim(lastDayMes);
        break;
        
      case 'personalizado':
        // Não altera as datas, usuário vai escolher manualmente
        break;
    }
  };
  
  const handleMesChange = (mesAno) => {
    setMesEscolhido(mesAno);
    const [year, month] = mesAno.split('-');
    const firstDay = new Date(parseInt(year), parseInt(month) - 1, 1).toISOString().split('T')[0];
    const lastDay = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];
    setDataInicio(firstDay);
    setDataFim(lastDay);
  };

  const { data: veiculos = [] } = useQuery({
    queryKey: ['veiculos'],
    queryFn: () => base44.entities.Veiculo.list(),
  });

  const { data: fetchedMacros = [] } = useQuery({
    queryKey: ['macros'],
    queryFn: () => base44.entities.MacroEvento.list('-data_criacao', 50000),
  });

  // Dedupicação e cálculo de jornadas lógicas
  const macros = useMemo(() => {
    const seen = new Set();
    const uniqueMacros = [];
    
    fetchedMacros.forEach(m => {
      const dateToSecond = new Date(m.data_criacao);
      dateToSecond.setMilliseconds(0);
      const key = `${m.veiculo_id}-${m.numero_macro}-${dateToSecond.toISOString()}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        uniqueMacros.push(m);
      }
    });
    
    // Calcular jornada_id e data_jornada para macros antigas
    const macrosPorVeiculo = {};
    uniqueMacros.forEach(m => {
      if (!macrosPorVeiculo[m.veiculo_id]) {
        macrosPorVeiculo[m.veiculo_id] = [];
      }
      macrosPorVeiculo[m.veiculo_id].push(m);
    });
    
    Object.values(macrosPorVeiculo).forEach(macrosVeiculo => {
      macrosVeiculo.sort((a, b) => new Date(a.data_criacao) - new Date(b.data_criacao));
      
      let jornadaAtual = null;
      
      macrosVeiculo.forEach(m => {
        if (!m.jornada_id) {
          if (m.numero_macro === 1) {
            const dataJornada = new Date(m.data_criacao).toISOString().split('T')[0];
            jornadaAtual = {
              jornadaId: `${m.veiculo_id}-${dataJornada}-${new Date(m.data_criacao).getTime()}`,
              dataJornada: dataJornada,
              aberta: true
            };
            m.jornada_id = jornadaAtual.jornadaId;
            m.data_jornada = jornadaAtual.dataJornada;
          } else if (jornadaAtual && jornadaAtual.aberta) {
            m.jornada_id = jornadaAtual.jornadaId;
            m.data_jornada = jornadaAtual.dataJornada;
            
            if (m.numero_macro === 2) {
              jornadaAtual.aberta = false;
            }
          }
        } else {
          if (m.numero_macro === 1) {
            jornadaAtual = {
              jornadaId: m.jornada_id,
              dataJornada: m.data_jornada,
              aberta: true
            };
          } else if (m.numero_macro === 2 && jornadaAtual) {
            jornadaAtual.aberta = false;
          }
        }
      });
    });
    
    return uniqueMacros;
  }, [fetchedMacros]);

  // Processar dados para ranking
  const rankingData = useMemo(() => {
    if (!dataInicio || !dataFim) return [];

    const motoristasMap = new Map();

    veiculos.forEach(veiculo => {
      const fleetNumber = extractFleetNumber(veiculo.nome_veiculo);
      const motorista = getDriverName(veiculo.nome_veiculo);
      const gestor = getManagerName(veiculo.nome_veiculo);

      // Aplicar filtros
      if (veiculoFiltro !== 'all' && veiculo.id !== veiculoFiltro) return;
      if (gestorFiltro !== 'all' && gestor !== gestorFiltro) return;

      const macrosVeiculo = macros.filter(m => 
        m.veiculo_id === veiculo.id &&
        m.data_jornada >= dataInicio &&
        m.data_jornada <= dataFim &&
        !m.excluido
      );

      if (macrosVeiculo.length === 0) return;

      // Agrupar por jornada
      const jornadasMap = new Map();
      macrosVeiculo.forEach(m => {
        if (!m.jornada_id) return;
        if (!jornadasMap.has(m.jornada_id)) {
          jornadasMap.set(m.jornada_id, []);
        }
        jornadasMap.get(m.jornada_id).push(m);
      });

      let totalHoras = 0;
      let totalHorasExtras = 0;
      let jornadasComExtras = 0;
      const totalJornadas = jornadasMap.size;

      jornadasMap.forEach(macrosJornada => {
        const jornadaLiquida = calcularJornadaLiquida(macrosJornada);
        const horasExtras = calcularHorasExtras(macrosJornada);
        
        totalHoras += jornadaLiquida;
        totalHorasExtras += horasExtras;
        if (horasExtras > 0) jornadasComExtras++;
      });

      const key = motorista || veiculo.nome_veiculo;
      
      if (!motoristasMap.has(key)) {
        motoristasMap.set(key, {
          motorista: key,
          veiculo: veiculo.nome_veiculo,
          gestor,
          totalHoras: 0,
          totalHorasExtras: 0,
          jornadasComExtras: 0,
          totalJornadas: 0
        });
      }

      const entry = motoristasMap.get(key);
      entry.totalHoras += totalHoras;
      entry.totalHorasExtras += totalHorasExtras;
      entry.jornadasComExtras += jornadasComExtras;
      entry.totalJornadas += totalJornadas;
    });

    return Array.from(motoristasMap.values())
      .map(item => ({
        ...item,
        mediaDiariaExtras: item.totalJornadas > 0 ? item.totalHorasExtras / item.totalJornadas : 0,
        percentualExcesso: item.totalJornadas > 0 ? (item.jornadasComExtras / item.totalJornadas) * 100 : 0
      }))
      .sort((a, b) => b.totalHorasExtras - a.totalHorasExtras);
  }, [veiculos, macros, dataInicio, dataFim, gestorFiltro, veiculoFiltro]);

  // Dados por gestor
  const gestoresData = useMemo(() => {
    const gestoresMap = new Map();
    
    rankingData.forEach(item => {
      const gestor = item.gestor || 'Sem Gestor';
      if (!gestoresMap.has(gestor)) {
        gestoresMap.set(gestor, { gestor, totalHorasExtras: 0 });
      }
      gestoresMap.get(gestor).totalHorasExtras += item.totalHorasExtras;
    });

    return Array.from(gestoresMap.values())
      .sort((a, b) => b.totalHorasExtras - a.totalHorasExtras);
  }, [rankingData]);

  // Lista única de gestores para filtro
  const gestoresUnicos = useMemo(() => {
    const set = new Set();
    veiculos.forEach(v => {
      const gestor = getManagerName(v.nome_veiculo);
      if (gestor) set.add(gestor);
    });
    return Array.from(set).sort();
  }, [veiculos]);

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filtros de Análise</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Filtro de Período */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Período</Label>
                <Select value={periodoPreset} onValueChange={handlePresetChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dia_anterior">Dia Anterior</SelectItem>
                    <SelectItem value="ultimos_7">Últimos 7 dias</SelectItem>
                    <SelectItem value="ultimos_15">Últimos 15 dias</SelectItem>
                    <SelectItem value="mes_atual">Mês Atual</SelectItem>
                    <SelectItem value="escolher_mes">Escolher por Mês</SelectItem>
                    <SelectItem value="personalizado">Personalizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {periodoPreset === 'escolher_mes' && (
                <div className="space-y-2">
                  <Label>Mês/Ano</Label>
                  <Input 
                    type="month" 
                    value={mesEscolhido}
                    onChange={(e) => handleMesChange(e.target.value)}
                  />
                </div>
              )}
              
              {periodoPreset === 'personalizado' && (
                <>
                  <div className="space-y-2">
                    <Label>Data Início</Label>
                    <Input 
                      type="date" 
                      value={dataInicio}
                      onChange={(e) => setDataInicio(e.target.value)}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Data Fim</Label>
                    <Input 
                      type="date" 
                      value={dataFim}
                      onChange={(e) => setDataFim(e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
            
            {/* Outros Filtros */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Gestor</Label>
                <Select value={gestorFiltro} onValueChange={setGestorFiltro}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {gestoresUnicos.map(g => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Veículo</Label>
                <Select value={veiculoFiltro} onValueChange={setVeiculoFiltro}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {veiculos.map(v => (
                      <SelectItem key={v.id} value={v.id}>{v.nome_veiculo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {/* Indicador do período selecionado */}
            <div className="text-sm text-slate-500 bg-slate-50 rounded p-2">
              Período: <span className="font-medium text-slate-700">{dataInicio}</span> até <span className="font-medium text-slate-700">{dataFim}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {(
        <>
          {/* Ranking de Horas Extras */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-500" />
                Ranking de Horas Extras
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={rankingData.slice(0, 10)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="motorista" angle={-45} textAnchor="end" height={100} />
                  <YAxis tickFormatter={(value) => (value / 60).toFixed(1)} />
                  <Tooltip 
                    formatter={(value) => minutesToHHMM(value)}
                    labelStyle={{ color: '#000' }}
                  />
                  <Legend />
                  <Bar dataKey="totalHoras" fill="#3b82f6" name="Horas Totais" />
                  <Bar dataKey="totalHorasExtras" fill="#ef4444" name="Horas Extras" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Comparativo por Gestor */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-500" />
                Horas Extras por Gestor
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={gestoresData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="gestor" />
                  <YAxis tickFormatter={(value) => (value / 60).toFixed(1)} />
                  <Tooltip formatter={(value) => minutesToHHMM(value)} />
                  <Bar dataKey="totalHorasExtras" fill="#f59e0b" name="Horas Extras" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Tabela Detalhada */}
          <Card>
            <CardHeader>
              <CardTitle>Detalhamento por Motorista</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Pos.</th>
                      <th className="text-left p-2">Motorista</th>
                      <th className="text-left p-2">Frota</th>
                      <th className="text-right p-2">Total Horas</th>
                      <th className="text-right p-2">Horas Extras</th>
                      <th className="text-right p-2">Média Diária</th>
                      <th className="text-right p-2">% Jornadas</th>
                      <th className="text-center p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankingData.map((item, idx) => (
                      <tr key={idx} className="border-b hover:bg-slate-50">
                        <td className="p-2 font-semibold">{idx + 1}</td>
                        <td className="p-2">{item.motorista}</td>
                        <td className="p-2 text-slate-500">{item.veiculo.replace(/[^0-9]/g, '').slice(0, 4)}</td>
                        <td className="p-2 text-right">{minutesToHHMM(item.totalHoras)}</td>
                        <td className="p-2 text-right font-semibold text-red-600">
                          {minutesToHHMM(item.totalHorasExtras)}
                        </td>
                        <td className="p-2 text-right">{minutesToHHMM(item.mediaDiariaExtras)}</td>
                        <td className="p-2 text-right">{item.percentualExcesso.toFixed(1)}%</td>
                        <td className="p-2 text-center">
                          {item.percentualExcesso > 50 ? (
                            <AlertTriangle className="w-4 h-4 text-red-500 mx-auto" />
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}