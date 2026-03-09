import React, { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import VehicleRow from './VehicleRow';
import VehicleFilters from './VehicleFilters';
import GridHeader from './GridHeader';
import { getManagerName } from './DriverData';
import { useUltimasPosicoes } from './useUltimasPosicoes';
import {
  getVehicleStatus,
  calcularJornadaLiquida,
  calcularTempoDisponivel,
  calcularHorasExtras,
  calcularInterjornada,
  verificarAlertaRefeicao,
  verificarAlertasInterjornada
} from './MacroUtils';

// Larguras iniciais em px por coluna
const DEFAULT_WIDTHS = {
  gestor: 90, frota: 60, motorista: 150, status: 100,
  ultimaPosicao: 170, dataHoraPosicao: 120, jornada: 65, disponivel: 70, hextra: 65, alertas: 70
};

export default function VehicleGrid({ veiculos, motoristas = [], gestores = [], macrosPorVeiculo, macrosOntemPorVeiculo, todasMacrosPorVeiculo, selectedDate }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [colWidths, setColWidths] = useState(DEFAULT_WIDTHS);

  const handleResizeCol = useCallback((key, width) => {
    setColWidths(prev => ({ ...prev, [key]: width }));
  }, []);

  // Buscar últimas posições com polling de 60s (somente se for o dia de hoje)
  const companyId = veiculos[0]?.company_id || null;
  const vehicleCodes = useMemo(() => veiculos.map(v => v.numero_frota).filter(Boolean), [veiculos]);
  const hoje = new Date().toISOString().split('T')[0];
  const isHoje = !selectedDate || selectedDate === hoje;
  const { positions: ultimasPosicoes } = useUltimasPosicoes(vehicleCodes, companyId, isHoje ? 60000 : null, selectedDate);
  const [alertFilter, setAlertFilter] = useState('all');
  const [sortBy, setSortBy] = useState('nome');
  const [sortOrder, setSortOrder] = useState('asc');
  const [columnFilters, setColumnFilters] = useState({
    gestor: null,
    frota: null,
    motorista: null,
    status: null,
  });

  const processedVehicles = useMemo(() => {
    return veiculos.map(v => {
      const macrosHoje = macrosPorVeiculo[v.id] || [];
      const macrosOntem = macrosOntemPorVeiculo[v.id] || [];
      
      const status = getVehicleStatus(macrosHoje);
      const jornadaLiquida = calcularJornadaLiquida(macrosHoje);
      const tempoDisponivel = calcularTempoDisponivel(macrosHoje);
      const horasExtras = calcularHorasExtras(macrosHoje);
      const interjornada = calcularInterjornada(macrosHoje, macrosOntem);
      const alertaRefeicao = verificarAlertaRefeicao(macrosHoje);
      const alertasInterjornada = verificarAlertasInterjornada(interjornada);

      // Buscar motorista e gestor relacionados
      const motorista = motoristas.find(m => m.id === v.motorista_id);
      const gestor = gestores.find(g => g.id === v.gestor_id);

      return {
        ...v,
        motorista,
        gestor,
        macrosHoje,
        macrosOntem,
        status,
        jornadaLiquida,
        tempoDisponivel,
        horasExtras,
        interjornada,
        alertaRefeicao,
        alertasInterjornada
      };
    });
  }, [veiculos, motoristas, gestores, macrosPorVeiculo, macrosOntemPorVeiculo]);

  const filteredAndSorted = useMemo(() => {
    let result = [...processedVehicles];

    // Filtro de busca
    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(v => v.nome_veiculo.toLowerCase().includes(searchLower));
    }

    // Filtro de status
    if (statusFilter !== 'all') {
      result = result.filter(v => v.status === statusFilter);
    }

    // Filtro de alertas
    if (alertFilter === 'refeicao') {
      result = result.filter(v => v.alertaRefeicao);
    } else if (alertFilter === 'interjornada11') {
      result = result.filter(v => v.alertasInterjornada.alerta11h && !v.alertasInterjornada.alerta8h);
    } else if (alertFilter === 'interjornada8') {
      result = result.filter(v => v.alertasInterjornada.alerta8h);
    }

    // Filtros por coluna
    if (columnFilters.gestor) {
      result = result.filter(v => {
        const gestorNome = v.gestor?.nome || getManagerName(v.nome_veiculo);
        return gestorNome === columnFilters.gestor;
      });
    }
    if (columnFilters.status) {
      result = result.filter(v => v.status === columnFilters.status);
    }

    // Ordenação
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'nome':
        case 'frota':
          const numA = parseInt(a.nome_veiculo.match(/\d+/)?.[0] || '0');
          const numB = parseInt(b.nome_veiculo.match(/\d+/)?.[0] || '0');
          comparison = numA - numB;
          break;
        case 'gestor':
          const gestorA = a.gestor?.nome || getManagerName(a.nome_veiculo);
          const gestorB = b.gestor?.nome || getManagerName(b.nome_veiculo);
          comparison = gestorA.localeCompare(gestorB);
          break;
        case 'motorista':
          comparison = a.nome_veiculo.localeCompare(b.nome_veiculo);
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'jornada':
          comparison = a.jornadaLiquida - b.jornadaLiquida;
          break;
        case 'disponivel':
          comparison = a.tempoDisponivel - b.tempoDisponivel;
          break;
        case 'hextra':
        case 'extras':
          comparison = a.horasExtras - b.horasExtras;
          break;
        case 'total':
          comparison = a.jornadaLiquida - b.jornadaLiquida;
          break;
        case 'alertas':
          const alertsA = (a.alertaRefeicao ? 1 : 0) + (a.alertasInterjornada.alerta11h ? 1 : 0) + (a.alertasInterjornada.alerta8h ? 1 : 0);
          const alertsB = (b.alertaRefeicao ? 1 : 0) + (b.alertasInterjornada.alerta11h ? 1 : 0) + (b.alertasInterjornada.alerta8h ? 1 : 0);
          comparison = alertsA - alertsB;
          break;
        default:
          comparison = 0;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [processedVehicles, search, statusFilter, alertFilter, sortBy, sortOrder, columnFilters]);

  // Obter valores únicos para filtros
  const gestoresUnicos = [...new Set(processedVehicles.map(v => {
    return v.gestor?.nome || getManagerName(v.nome_veiculo);
  }).filter(g => g !== '—'))].sort();
  const statuses = [...new Set(processedVehicles.map(v => v.status))].sort();

  // 12 colunas (sem "Total")
  const columns = [
    {
      key: 'gestor',
      label: 'Gestor',
      filterable: true,
      draggable: true,
      sortable: true,
      filterOptions: gestoresUnicos.map(g => ({ value: g, label: g }))
    },
    {
      key: 'frota',
      label: 'Frota',
      draggable: true,
      filterable: false,
      sortable: true
    },
    {
      key: 'motorista',
      label: 'Motorista',
      draggable: true,
      filterable: false,
      sortable: true
    },
    {
      key: 'status',
      label: 'Status',
      filterable: true,
      draggable: true,
      sortable: true,
      filterOptions: statuses.map(s => ({ value: s, label: s }))
    },
    {
      key: 'ultimaPosicao',
      label: 'Última Posição',
      filterable: false,
      sortable: false
    },
    {
      key: 'dataHoraPosicao',
      label: 'Data/Hora',
      filterable: false,
      sortable: false
    },
    {
      key: 'jornada',
      label: 'Jornada',
      align: 'text-center',
      filterable: false,
      sortable: true
    },
    {
      key: 'disponivel',
      label: 'Disponível',
      align: 'text-center',
      filterable: false,
      sortable: true
    },
    {
      key: 'hextra',
      label: 'H. Extra',
      align: 'text-center',
      filterable: false,
      sortable: true
    },
    {
      key: 'alertas',
      label: 'Alertas',
      align: 'text-right',
      filterable: false,
      sortable: true
    }
  ];

  const handleColumnFilter = (columnKey, value) => {
    setColumnFilters(prev => ({
      ...prev,
      [columnKey]: value
    }));
  };

  const handleSort = (columnKey) => {
    if (sortBy === columnKey) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(columnKey);
      setSortOrder('asc');
    }
  };

  return (
    <div className="space-y-4">
      <VehicleFilters
        search={search}
        setSearch={setSearch}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        sortBy={sortBy}
        setSortBy={setSortBy}
        sortOrder={sortOrder}
        setSortOrder={setSortOrder}
        alertFilter={alertFilter}
        setAlertFilter={setAlertFilter}
      />

      {/* Cabeçalho com filtros */}
      <GridHeader
        columns={columns}
        colWidths={colWidths}
        onResizeCol={handleResizeCol}
        onFilterChange={handleColumnFilter}
        filters={columnFilters}
        onSort={handleSort}
        sortBy={sortBy}
        sortOrder={sortOrder}
      />

      {/* Lista de veículos */}
      <div className="space-y-2">
        {filteredAndSorted.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12 text-slate-400"
          >
            {veiculos.length === 0 
              ? 'Nenhum veículo cadastrado. Importe dados para começar.'
              : 'Nenhum veículo encontrado com os filtros aplicados.'}
          </motion.div>
        ) : (
          filteredAndSorted.map((v, idx) => (
            <motion.div
              key={v.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.03 }}
            >
              <VehicleRow
                veiculo={v}
                macrosHoje={v.macrosHoje}
                macrosOntem={v.macrosOntem}
                todasMacros={todasMacrosPorVeiculo ? todasMacrosPorVeiculo[v.id] : null}
                ultimaPosicao={ultimasPosicoes[v.numero_frota] || null}
                colWidths={colWidths}
                selectedDate={selectedDate}
              />
            </motion.div>
          ))
        )}
      </div>

      {/* Contador */}
      {filteredAndSorted.length > 0 && (
        <div className="text-sm text-slate-500 text-center pt-2">
          Exibindo {filteredAndSorted.length} de {veiculos.length} veículos
        </div>
      )}
    </div>
  );
}