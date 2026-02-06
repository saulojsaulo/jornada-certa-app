import React, { useState } from 'react';
import { Filter, GripVertical, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function GridHeader({ columns, onFilterChange, filters, onSort, sortBy, sortOrder }) {
  return (
    <div className="hidden md:grid grid-cols-12 gap-3 px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider bg-slate-50 rounded-lg border border-slate-200 mb-2">
      {columns.map((column) => (
        <div
          key={column.key}
          className={`${column.span} flex items-center gap-1 ${column.align || ''} whitespace-nowrap`}
        >
          {column.draggable && (
            <GripVertical className="w-3 h-3 text-slate-400 cursor-move" />
          )}
          <button
            onClick={() => column.sortable && onSort && onSort(column.key)}
            className={`flex items-center gap-1 ${column.sortable ? 'cursor-pointer hover:text-slate-800 transition-colors' : ''}`}
          >
            <span>{column.label}</span>
            {column.sortable && onSort && (
              <span className="text-slate-400">
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
                <button className="ml-1 hover:bg-slate-200 rounded p-0.5">
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
        </div>
      ))}
    </div>
  );
}