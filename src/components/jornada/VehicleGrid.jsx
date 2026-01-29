import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import VehicleRow from './VehicleRow';
import VehicleFilters from './VehicleFilters';
import {
  getVehicleStatus,
  calcularJornadaLiquida,
  calcularTempoDisponivel,
  calcularHorasExtras,
  calcularInterjornada,
  verificarAlertaRefeicao,
  verificarAlertasInterjornada
} from './MacroUtils';

export default function VehicleGrid({ veiculos, macrosPorVeiculo, macrosOntemPorVeiculo }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [alertFilter, setAlertFilter] = useState('all');
  const [sortBy, setSortBy] = useState('nome');
  const [sortOrder, setSortOrder] = useState('asc');

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

    // Ordenação
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'nome':
          comparison = a.nome_veiculo.localeCompare(b.nome_veiculo);
          break;
        case 'jornada':
          comparison = a.jornadaLiquida - b.jornadaLiquida;
          break;
        case 'disponivel':
          comparison = a.tempoDisponivel - b.tempoDisponivel;
          break;
        case 'extras':
          comparison = a.horasExtras - b.horasExtras;
          break;
        default:
          comparison = 0;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [processedVehicles, search, statusFilter, alertFilter, sortBy, sortOrder]);

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

      {/* Cabeçalho da grade */}
      <div className="hidden md:grid grid-cols-12 gap-3 px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider bg-slate-50 rounded-lg border border-slate-200 mb-2">
        <div className="col-span-1">Gestor</div>
        <div className="col-span-1">Frota</div>
        <div className="col-span-2">Motorista</div>
        <div className="col-span-2">Status</div>
        <div className="col-span-1 text-center">Jornada</div>
        <div className="col-span-1 text-center">Disponível</div>
        <div className="col-span-1 text-center">H. Extra</div>
        <div className="col-span-1 text-center">Total</div>
        <div className="col-span-2 text-right">Alertas</div>
      </div>

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