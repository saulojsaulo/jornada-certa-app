import React from 'react';
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, Filter, X, ArrowUpDown } from 'lucide-react';

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos os Status' },
  { value: 'Em Jornada', label: 'Em Jornada' },
  { value: 'Em Refeição', label: 'Em Refeição' },
  { value: 'Em Repouso', label: 'Em Repouso' },
  { value: 'Em Complemento', label: 'Em Complemento' },
  { value: 'Fim de Jornada', label: 'Fim de Jornada' },
  { value: 'Sem Jornada', label: 'Sem Jornada' }
];

const SORT_OPTIONS = [
  { value: 'nome', label: 'Nome' },
  { value: 'jornada', label: 'Tempo de Jornada' },
  { value: 'disponivel', label: 'Tempo Disponível' },
  { value: 'extras', label: 'Horas Extras' }
];

export default function VehicleFilters({ 
  search, 
  setSearch, 
  statusFilter, 
  setStatusFilter,
  sortBy,
  setSortBy,
  sortOrder,
  setSortOrder,
  alertFilter,
  setAlertFilter
}) {
  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setAlertFilter('all');
    setSortBy('nome');
    setSortOrder('asc');
  };

  const hasFilters = search || statusFilter !== 'all' || alertFilter !== 'all';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
      <div className="flex flex-wrap gap-3 items-center">
        {/* Busca */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Buscar veículo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-slate-50 border-slate-200"
          />
        </div>

        {/* Filtro de Status */}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] bg-slate-50">
            <Filter className="w-4 h-4 mr-2 text-slate-400" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Filtro de Alertas */}
        <Select value={alertFilter} onValueChange={setAlertFilter}>
          <SelectTrigger className="w-[180px] bg-slate-50">
            <SelectValue placeholder="Alertas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="refeicao">🍽️ Alerta Refeição</SelectItem>
            <SelectItem value="interjornada11">🌙 Interjornada &lt;11h</SelectItem>
            <SelectItem value="interjornada8">💣 Interjornada &lt;8h</SelectItem>
          </SelectContent>
        </Select>

        {/* Ordenação */}
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[160px] bg-slate-50">
            <ArrowUpDown className="w-4 h-4 mr-2 text-slate-400" />
            <SelectValue placeholder="Ordenar" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Direção da ordenação */}
        <Button
          variant="outline"
          size="icon"
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          className="bg-slate-50"
        >
          <ArrowUpDown className={`w-4 h-4 ${sortOrder === 'desc' ? 'rotate-180' : ''} transition-transform`} />
        </Button>

        {/* Limpar filtros */}
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-slate-500 hover:text-slate-700"
          >
            <X className="w-4 h-4 mr-1" />
            Limpar
          </Button>
        )}
      </div>
    </div>
  );
}