import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus } from 'lucide-react';
import VeiculosTab from '../components/cadastros/VeiculosTab';
import MotoristasTab from '../components/cadastros/MotoristasTab';
import GestoresTab from '../components/cadastros/GestoresTab';
import MigrarDados from '../components/cadastros/MigrarDados';

export default function Cadastros() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-800">Cadastros</h1>
          <p className="text-slate-600 mt-1">Gerencie veículos, motoristas e gestores</p>
        </div>

        <div className="mb-6">
          <MigrarDados />
        </div>

        <Tabs defaultValue="veiculos" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="veiculos">Veículos</TabsTrigger>
            <TabsTrigger value="motoristas">Motoristas</TabsTrigger>
            <TabsTrigger value="gestores">Gestores</TabsTrigger>
          </TabsList>

          <TabsContent value="veiculos">
            <VeiculosTab />
          </TabsContent>

          <TabsContent value="motoristas">
            <MotoristasTab />
          </TabsContent>

          <TabsContent value="gestores">
            <GestoresTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}