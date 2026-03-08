import React, { useState } from 'react';
import { Filter, GripVertical, ChevronUp, ChevronDown, ChevronsUpDown, Plus, Minus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function GridHeader({ columns, colSpans, onAdjustSpan, onFilterChange, filters, onSort, sortBy, sortOrder }) {
  const [hoveredCol, setHoveredCol] = useState(null);

  const gridTemplate = columns.map(c => `${colSpans[c.key] || 1}fr`).join(' ');

  return (
    <div
      className="hidden md:grid gap-1 px-3 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wider bg-slate-50 rounded-lg border border-slate-200 mb-2"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      {columns.map((column) => (
        <div
          key={column.key}
          className={`flex items-center gap-1 ${column.align || ''} whitespace-nowrap relative group`}
          onMouseEnter={() => setHoveredCol(column.key)}
          onMouseLeave={() => setHoveredCol(null)}
        >
          {column.draggable && (
            <GripVertical className="w-3 h-3 text-slate-400 cursor-move shrink-0" />
          )}

          <button
            onClick={() => column.sortable && onSort && onSort(column.key)}
            className={`flex items-center gap-1 min-w-0 ${column.sortable ? 'cursor-pointer hover:text-slate-800 transition-colors' : ''}`}
          >
            <span className="truncate">{column.label}</span>
            {column.sortable && onSort && (
              <span className="text-slate-400 shrink-0">
                {sortBy === column.key ? (
                  sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronsUpDown className="w-3 h-3 opacity-30" />
                )}
              </span>
            )}
          </button>

          {column.filterable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-1 hover:bg-slate-200 rounded p-0.5 shrink-0">
                  <Filter className={`w-3 h-3 ${filters[column.key] ? 'text-blue-600' : 'text-slate-400'}`} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-64 overflow-auto">
                <DropdownMenuItem onClick={() => onFilterChange(column.key, null)}>
                  <span className="font-medium">Todos</span>
                </DropdownMenuItem>
                {column.filterOptions?.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => onFilterChange(column.key, option.value)}
                    className={filters[column.key] === option.value ? 'bg-blue-50' : ''}
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Botões de largura - aparecem no hover */}
          {hoveredCol === column.key && onAdjustSpan && (
            <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-0.5 bg-white border border-slate-200 rounded shadow-sm z-10">
              <button
                onClick={(e) => { e.stopPropagation(); onAdjustSpan(column.key, -1); }}
                className="p-0.5 hover:bg-slate-100 text-slate-500 rounded-l disabled:opacity-30"
                disabled={(colSpans[column.key] || 1) <= 1}
                title="Diminuir largura"
              >
                <Minus className="w-2.5 h-2.5" />
              </button>
              <span className="text-[9px] text-slate-400 px-0.5">{colSpans[column.key] || 1}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onAdjustSpan(column.key, 1); }}
                className="p-0.5 hover:bg-slate-100 text-slate-500 rounded-r disabled:opacity-30"
                disabled={(colSpans[column.key] || 1) >= 5}
                title="Aumentar largura"
              >
                <Plus className="w-2.5 h-2.5" />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}