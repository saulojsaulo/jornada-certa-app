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
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [gestorFiltro, setGestorFiltro] = useState('all');
  const [veiculoFiltro, setVeiculoFiltro] = useState('all');

  const { data: veiculos = [] } = useQuery({
    queryKey: ['veiculos'],
    queryFn: () => base44.entities.Veiculo.list(),
  });

  const { data: macros = [] } = useQuery({
    queryKey: ['macros'],
    queryFn: () => base44.entities.MacroEvento.list('-data_criacao', 50000),
  });

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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
        </CardContent>
      </Card>

      {!dataInicio || !dataFim ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500">
            Selecione um período para visualizar o ranking
          </CardContent>
        </Card>
      ) : (
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
                  <YAxis />
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
                  <YAxis />
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
                      <th className="text-left p-2">Veículo</th>
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
                        <td className="p-2 text-slate-500">{item.veiculo}</td>
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