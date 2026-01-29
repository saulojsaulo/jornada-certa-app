import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from "@/components/ui/card";
import { Truck, Users, Clock, AlertTriangle } from 'lucide-react';

export default function StatsCards({ veiculos, macrosPorVeiculo, macrosOntemPorVeiculo }) {
  const totalVeiculos = veiculos.length;
  
  let emJornada = 0;
  let emPausa = 0;
  let alertas = 0;

  veiculos.forEach(v => {
    const macros = macrosPorVeiculo[v.id] || [];
    if (macros.length === 0) return;

    const sorted = [...macros].sort((a, b) => new Date(a.data_criacao) - new Date(b.data_criacao));
    
    const has1 = sorted.some(m => m.numero_macro === 1);
    const has2 = sorted.some(m => m.numero_macro === 2);
    const count3 = sorted.filter(m => m.numero_macro === 3).length;
    const count4 = sorted.filter(m => m.numero_macro === 4).length;
    const count5 = sorted.filter(m => m.numero_macro === 5).length;
    const count6 = sorted.filter(m => m.numero_macro === 6).length;
    const count9 = sorted.filter(m => m.numero_macro === 9).length;
    const count10 = sorted.filter(m => m.numero_macro === 10).length;

    // Em pausa
    if (count3 > count4 || count5 > count6 || count9 > count10) {
      emPausa++;
    } else if (has1 && !has2) {
      emJornada++;
    }

    // Verificar alertas de refeição
    const macro1 = sorted.find(m => m.numero_macro === 1);
    const macro3 = sorted.find(m => m.numero_macro === 3);
    if (macro1 && !has2 && !macro3) {
      const tempoDesdeInicio = (new Date() - new Date(macro1.data_criacao)) / (1000 * 60);
      if (tempoDesdeInicio > 360) alertas++;
    }

    // Verificar interjornada
    const macrosOntem = macrosOntemPorVeiculo[v.id] || [];
    if (macrosOntem.length > 0 && macros.length > 0) {
      const sortedOntem = [...macrosOntem].sort((a, b) => new Date(a.data_criacao) - new Date(b.data_criacao));
      const macro2Ontem = sortedOntem.find(m => m.numero_macro === 2);
      const macro1Hoje = sorted.find(m => m.numero_macro === 1);
      
      if (macro2Ontem && macro1Hoje) {
        const intervalo = (new Date(macro1Hoje.data_criacao) - new Date(macro2Ontem.data_criacao)) / (1000 * 60);
        if (intervalo < 480) alertas++;
      }
    }
  });

  const cards = [
    { label: 'Total Veículos', value: totalVeiculos, icon: Truck, color: 'from-slate-500 to-slate-600' },
    { label: 'Em Jornada', value: emJornada, icon: Users, color: 'from-emerald-500 to-emerald-600' },
    { label: 'Em Pausa', value: emPausa, icon: Clock, color: 'from-amber-500 to-amber-600' },
    { label: 'Alertas Ativos', value: alertas, icon: AlertTriangle, color: 'from-red-500 to-red-600' }
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card, idx) => (
        <motion.div
          key={card.label}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.1 }}
        >
          <Card className={`overflow-hidden border-0 shadow-lg bg-gradient-to-br ${card.color}`}>
            <CardContent className="p-5 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/80 text-sm">{card.label}</p>
                  <p className="text-3xl font-bold mt-1">{card.value}</p>
                </div>
                <card.icon className="w-10 h-10 text-white/30" />
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}