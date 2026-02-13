import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Plus, Pencil, Trash2, Truck } from 'lucide-react';
import { motion } from 'framer-motion';

export default function VeiculosTab() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVeiculo, setEditingVeiculo] = useState(null);
  const [formData, setFormData] = useState({
    nome_veiculo: '',
    numero_frota: '',
    placa: '',
    motorista_id: '',
    gestor_id: '',
    ativo: true
  });

  const queryClient = useQueryClient();

  const { data: veiculos = [] } = useQuery({
    queryKey: ['veiculos'],
    queryFn: () => base44.entities.Veiculo.list()
  });

  const { data: motoristas = [] } = useQuery({
    queryKey: ['motoristas'],
    queryFn: () => base44.entities.Motorista.list()
  });

  const { data: gestores = [] } = useQuery({
    queryKey: ['gestores'],
    queryFn: () => base44.entities.Gestor.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Veiculo.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['veiculos']);
      handleCloseDialog();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Veiculo.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['veiculos']);
      handleCloseDialog();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Veiculo.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['veiculos']);
    }
  });

  const handleOpenDialog = (veiculo = null) => {
    if (veiculo) {
      setEditingVeiculo(veiculo);
      setFormData({
        nome_veiculo: veiculo.nome_veiculo || '',
        numero_frota: veiculo.numero_frota || '',
        placa: veiculo.placa || '',
        motorista_id: veiculo.motorista_id || '',
        gestor_id: veiculo.gestor_id || '',
        ativo: veiculo.ativo !== false
      });
    } else {
      setEditingVeiculo(null);
      setFormData({
        nome_veiculo: '',
        numero_frota: '',
        placa: '',
        motorista_id: '',
        gestor_id: '',
        ativo: true
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingVeiculo(null);
  };

  const handleSubmit = () => {
    if (editingVeiculo) {
      updateMutation.mutate({ id: editingVeiculo.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id) => {
    if (confirm('Tem certeza que deseja excluir este veículo?')) {
      deleteMutation.mutate(id);
    }
  };

  const getMotoristaName = (id) => {
    const motorista = motoristas.find(m => m.id === id);
    return motorista?.nome || '—';
  };

  const getGestorName = (id) => {
    const gestor = gestores.find(g => g.id === id);
    return gestor?.nome || '—';
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Veículos</h2>
          <p className="text-sm text-slate-600">Total: {veiculos.length}</p>
        </div>
        <Button onClick={() => handleOpenDialog()}>
          <Plus className="w-4 h-4 mr-2" />
          Novo Veículo
        </Button>
      </div>

      <div className="grid gap-3">
        {veiculos.map((veiculo, idx) => (
          <motion.div
            key={veiculo.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.03 }}
          >
            <Card className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-center">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                    <Truck className="w-5 h-5 text-slate-600" />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800">{veiculo.numero_frota || veiculo.nome_veiculo}</div>
                    <div className="text-xs text-slate-500">{veiculo.placa || '—'}</div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-slate-500">Nome Veículo</div>
                  <div className="text-sm text-slate-700">{veiculo.nome_veiculo}</div>
                </div>

                <div>
                  <div className="text-xs text-slate-500">Motorista</div>
                  <div className="text-sm font-medium text-slate-700">{getMotoristaName(veiculo.motorista_id)}</div>
                </div>

                <div>
                  <div className="text-xs text-slate-500">Gestor</div>
                  <div className="text-sm font-medium text-slate-700">{getGestorName(veiculo.gestor_id)}</div>
                </div>

                <div>
                  <div className="text-xs text-slate-500">Status</div>
                  <div className={`text-sm font-medium ${veiculo.ativo ? 'text-green-600' : 'text-red-600'}`}>
                    {veiculo.ativo ? 'Ativo' : 'Inativo'}
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleOpenDialog(veiculo)}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(veiculo.id)}
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingVeiculo ? 'Editar Veículo' : 'Novo Veículo'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome do Veículo *</Label>
              <Input
                value={formData.nome_veiculo}
                onChange={(e) => setFormData({ ...formData, nome_veiculo: e.target.value })}
                placeholder="Ex: Veículo 026"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Número Frota</Label>
                <Input
                  value={formData.numero_frota}
                  onChange={(e) => setFormData({ ...formData, numero_frota: e.target.value })}
                  placeholder="026"
                />
              </div>

              <div className="space-y-2">
                <Label>Placa</Label>
                <Input
                  value={formData.placa}
                  onChange={(e) => setFormData({ ...formData, placa: e.target.value })}
                  placeholder="ABC-1234"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Motorista</Label>
              <Select
                value={formData.motorista_id}
                onValueChange={(value) => setFormData({ ...formData, motorista_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o motorista" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Nenhum</SelectItem>
                  {motoristas.filter(m => m.ativo).map(motorista => (
                    <SelectItem key={motorista.id} value={motorista.id}>
                      {motorista.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Gestor</Label>
              <Select
                value={formData.gestor_id}
                onValueChange={(value) => setFormData({ ...formData, gestor_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o gestor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Nenhum</SelectItem>
                  {gestores.filter(g => g.ativo).map(gestor => (
                    <SelectItem key={gestor.id} value={gestor.id}>
                      {gestor.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="ativo"
                checked={formData.ativo}
                onChange={(e) => setFormData({ ...formData, ativo: e.target.checked })}
                className="rounded"
              />
              <Label htmlFor="ativo" className="cursor-pointer">Veículo ativo</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit}>
              {editingVeiculo ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}