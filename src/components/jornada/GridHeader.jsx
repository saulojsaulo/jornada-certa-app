import React, { useRef, useCallback } from 'react';
import { Filter, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function GridHeader({ columns, colWidths, onResizeCol, onFilterChange, filters, onSort, sortBy, sortOrder }) {
  const dragging = useRef(null);

  const onMouseDown = useCallback((e, key) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colWidths[key];
    dragging.current = key;

    const onMove = (me) => {
      const delta = me.clientX - startX;
      const newWidth = Math.max(40, startWidth + delta);
      onResizeCol(key, newWidth);
    };

    const onUp = () => {
      dragging.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [colWidths, onResizeCol]);

  const gridTemplate = columns.map(c => `${colWidths[c.key] || 80}px`).join(' ');

  return (
    <div
      className="hidden md:grid text-xs font-semibold text-slate-600 uppercase tracking-wider bg-slate-50 rounded-lg border border-slate-200 mb-2 overflow-hidden select-none"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      {columns.map((column) => (
        <div
          key={column.key}
          className={`relative flex items-center gap-1 px-2 py-2 ${column.align || ''}`}
          style={{ minWidth: 0 }}
        >
          <button
            onClick={() => column.sortable && onSort && onSort(column.key)}
            className={`flex items-center gap-1 min-w-0 overflow-hidden ${column.sortable ? 'cursor-pointer hover:text-slate-800 transition-colors' : 'cursor-default'}`}
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
                <button className="ml-auto hover:bg-slate-200 rounded p-0.5 shrink-0">
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

          {/* Handle de redimensionamento */}
          <div
            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 active:bg-blue-600 transition-colors z-10"
            onMouseDown={(e) => onMouseDown(e, column.key)}
          />
        </div>
      ))}
    </div>
  );
}