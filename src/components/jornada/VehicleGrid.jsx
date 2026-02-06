import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import VehicleRow from './VehicleRow';
import VehicleFilters from './VehicleFilters';
import GridHeader from './GridHeader';
import { getManagerName } from './DriverData';
import {
  getVehicleStatus,
  calcularJornadaLiquida,
  calcularTempoDisponivel,
  calcularHorasExtras,
  calcularInterjornada,
  verificarAlertaRefeicao,
  verificarAlertasInterjornada
} from './MacroUtils';

export default function VehicleGrid({ veiculos, macrosPorVeiculo, macrosOntemPorVeiculo, todasMacrosPorVeiculo }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
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

      return {
        ...v,
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
  }, [veiculos, macrosPorVeiculo, macrosOntemPorVeiculo]);

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
      result = result.filter(v => getManagerName(v.nome_veiculo) === columnFilters.gestor);
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
          comparison = getManagerName(a.nome_veiculo).localeCompare(getManagerName(b.nome_veiculo));
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
  const gestores = [...new Set(processedVehicles.map(v => getManagerName(v.nome_veiculo)).filter(g => g !== '—'))].sort();
  const statuses = [...new Set(processedVehicles.map(v => v.status))].sort();

  const columns = [
    {
      key: 'gestor',
      label: 'Gestor',
      span: 'col-span-1',
      filterable: true,
      draggable: true,
      sortable: true,
      filterOptions: gestores.map(g => ({ value: g, label: g }))
    },
    {
      key: 'frota',
      label: 'Frota',
      span: 'col-span-1',
      draggable: true,
      filterable: false,
      sortable: true
    },
    {
      key: 'motorista',
      label: 'Motorista',
      span: 'col-span-3',
      draggable: true,
      filterable: false,
      sortable: true
    },
    {
      key: 'status',
      label: 'Status',
      span: 'col-span-2',
      filterable: true,
      draggable: true,
      sortable: true,
      filterOptions: statuses.map(s => ({ value: s, label: s }))
    },
    {
      key: 'jornada',
      label: 'Jornada',
      span: 'col-span-1',
      align: 'text-center',
      filterable: false,
      sortable: true
    },
    {
      key: 'disponivel',
      label: 'Disponível',
      span: 'col-span-1',
      align: 'text-center',
      filterable: false,
      sortable: true
    },
    {
      key: 'hextra',
      label: 'H. Extra',
      span: 'col-span-1',
      align: 'text-center',
      filterable: false,
      sortable: true
    },
    {
      key: 'total',
      label: 'Total',
      span: 'col-span-1',
      align: 'text-center',
      filterable: false,
      sortable: true
    },
    {
      key: 'alertas',
      label: 'Alertas',
      span: 'col-span-1',
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