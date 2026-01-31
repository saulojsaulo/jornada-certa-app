import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, Coffee, Moon } from 'lucide-react';
import { 
  calcularJornadaBruta,
  calcularJornadaLiquida, 
  calcularHorasExtras, 
  minutesToHHMM,
  verificarAlertaRefeicao,
  verificarAlertasInterjornada 
} from './MacroUtils';
import { getDriverName, getManagerName } from './DriverData';
import VehicleTimeline from './VehicleTimeline';

export default function FiltroMotoristaTab() {
  const [veiculoSelecionado, setVeiculoSelecionado] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [jornadaExpandida, setJornadaExpandida] = useState(null);

  const { data: veiculos = [] } = useQuery({
    queryKey: ['veiculos'],
    queryFn: () => base44.entities.Veiculo.list(),
  });

  const { data: macros = [] } = useQuery({
    queryKey: ['macros'],
    queryFn: () => base44.entities.MacroEvento.list('-data_criacao', 50000),
  });

  // Processar jornadas do veículo selecionado
  const jornadasData = useMemo(() => {
    if (!veiculoSelecionado || !dataInicio || !dataFim) return { jornadas: [], totais: null, alertas: [] };

    const macrosVeiculo = macros.filter(m => 
      m.veiculo_id === veiculoSelecionado &&
      m.data_jornada >= dataInicio &&
      m.data_jornada <= dataFim &&
      !m.excluido
    );

    // Agrupar por jornada
    const jornadasMap = new Map();
    macrosVeiculo.forEach(m => {
      if (!m.jornada_id) return;
      if (!jornadasMap.has(m.jornada_id)) {
        jornadasMap.set(m.jornada_id, {
          jornada_id: m.jornada_id,
          data_jornada: m.data_jornada,
          macros: []
        });
      }
      jornadasMap.get(m.jornada_id).macros.push(m);
    });

    let totalHoras = 0;
    let totalHorasExtras = 0;
    let jornadasExcedidas = 0;
    const alertas = [];

    const jornadas = Array.from(jornadasMap.values()).map(j => {
      const sorted = j.macros.sort((a, b) => new Date(a.data_criacao) - new Date(b.data_criacao));
      const macro1 = sorted.find(m => m.numero_macro === 1);
      const macro2 = sorted.find(m => m.numero_macro === 2);

      const jornadaBruta = calcularJornadaBruta(j.macros);
      const jornadaLiquida = calcularJornadaLiquida(j.macros);
      const horasExtras = calcularHorasExtras(j.macros);
      const excedida = jornadaLiquida > 720;

      totalHoras += jornadaLiquida;
      totalHorasExtras += horasExtras;
      if (excedida) jornadasExcedidas++;

      // Verificar alertas
      const alertaRefeicao = verificarAlertaRefeicao(j.macros);
      if (alertaRefeicao.temAlerta) {
        alertas.push({
          tipo: 'Refeição',
          data: j.data_jornada,
          descricao: alertaRefeicao.mensagem,
          criticidade: 'média'
        });
      }

      return {
        ...j,
        horaInicio: macro1 ? new Date(macro1.data_criacao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-',
        horaFim: macro2 ? new Date(macro2.data_criacao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-',
        jornadaBruta,
        jornadaLiquida,
        horasExtras,
        excedida
      };
    }).sort((a, b) => b.data_jornada.localeCompare(a.data_jornada));

    // Verificar alertas de interjornada
    jornadas.forEach((j, idx) => {
      if (idx < jornadas.length - 1) {
        const proxima = jornadas[idx + 1];
        const alertasInter = verificarAlertasInterjornada(j.macros, proxima.macros);
        alertasInter.forEach(a => {
          alertas.push({
            tipo: 'Interjornada',
            data: j.data_jornada,
            descricao: a.mensagem,
            criticidade: a.critico ? 'alta' : 'média'
          });
        });
      }
    });

    const totalJornadas = jornadas.length;
    const mediaDiaria = totalJornadas > 0 ? totalHoras / totalJornadas : 0;

    return {
      jornadas,
      totais: {
        totalHoras,
        totalHorasExtras,
        mediaDiaria,
        jornadasExcedidas,
        totalJornadas
      },
      alertas
    };
  }, [veiculoSelecionado, dataInicio, dataFim, macros]);

  const veiculoInfo = veiculos.find(v => v.id === veiculoSelecionado);
  const motorista = veiculoInfo ? getDriverName(veiculoInfo.nome_veiculo) : '';

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filtros de Consulta</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Veículo / Motorista</Label>
              <Select value={veiculoSelecionado} onValueChange={setVeiculoSelecionado}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {veiculos.map(v => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.nome_veiculo} - {getDriverName(v.nome_veiculo) || 'Sem motorista'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
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
          </div>
        </CardContent>
      </Card>

      {!veiculoSelecionado || !dataInicio || !dataFim ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500">
            Selecione um veículo e período para consultar
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Totalizadores */}
          {jornadasData.totais && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-slate-500">Total Horas</div>
                  <div className="text-2xl font-bold">{minutesToHHMM(jornadasData.totais.totalHoras)}</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-slate-500">Horas Extras</div>
                  <div className="text-2xl font-bold text-red-600">{minutesToHHMM(jornadasData.totais.totalHorasExtras)}</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-slate-500">Média Diária</div>
                  <div className="text-2xl font-bold">{minutesToHHMM(jornadasData.totais.mediaDiaria)}</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-slate-500">Jornadas</div>
                  <div className="text-2xl font-bold">{jornadasData.totais.totalJornadas}</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-slate-500">Excedidas</div>
                  <div className="text-2xl font-bold text-orange-600">{jornadasData.totais.jornadasExcedidas}</div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Alertas */}
          {jornadasData.alertas.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  Alertas do Período ({jornadasData.alertas.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {jornadasData.alertas.map((alerta, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
                      {alerta.tipo === 'Refeição' ? (
                        <Coffee className="w-4 h-4 text-amber-600 mt-0.5" />
                      ) : (
                        <Moon className="w-4 h-4 text-purple-600 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{alerta.tipo}</span>
                          <Badge variant={alerta.criticidade === 'alta' ? 'destructive' : 'secondary'}>
                            {alerta.data}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-600 mt-1">{alerta.descricao}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Grid de Jornadas */}
          <Card>
            <CardHeader>
              <CardTitle>Histórico de Jornadas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {jornadasData.jornadas.map((jornada, idx) => (
                  <div key={idx} className="border rounded-lg overflow-hidden">
                    <div 
                      className="p-4 hover:bg-slate-50 cursor-pointer flex items-center justify-between"
                      onClick={() => setJornadaExpandida(jornadaExpandida === jornada.jornada_id ? null : jornada.jornada_id)}
                    >
                      <div className="flex items-center gap-6">
                        <div>
                          <div className="text-sm text-slate-500">Data</div>
                          <div className="font-semibold">{jornada.data_jornada}</div>
                        </div>
                        <div>
                          <div className="text-sm text-slate-500">Início</div>
                          <div className="font-semibold">{jornada.horaInicio}</div>
                        </div>
                        <div>
                          <div className="text-sm text-slate-500">Fim</div>
                          <div className="font-semibold">{jornada.horaFim}</div>
                        </div>
                        <div>
                          <div className="text-sm text-slate-500">Jornada Líquida</div>
                          <div className="font-semibold text-blue-600">{minutesToHHMM(jornada.jornadaLiquida)}</div>
                        </div>
                        <div>
                          <div className="text-sm text-slate-500">Horas Extras</div>
                          <div className={`font-semibold ${jornada.horasExtras > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                            {minutesToHHMM(jornada.horasExtras)}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {jornada.excedida && (
                          <Badge variant="destructive">Excedida</Badge>
                        )}
                        <Clock className="w-4 h-4 text-slate-400" />
                      </div>
                    </div>
                    
                    {jornadaExpandida === jornada.jornada_id && (
                      <VehicleTimeline 
                        macros={jornada.macros} 
                        dataReferencia={jornada.data_jornada} 
                      />
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}