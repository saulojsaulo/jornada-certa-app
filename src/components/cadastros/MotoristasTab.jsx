import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Plus, Pencil, Trash2, User, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';

export default function MotoristasTab() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMotorista, setEditingMotorista] = useState(null);
  const [formData, setFormData] = useState({
    nome: '',
    cpf: '',
    telefone: '',
    ativo: true
  });
  const [isSubstituindo, setIsSubstituindo] = useState(false);

  const queryClient = useQueryClient();

  const { data: motoristas = [] } = useQuery({
    queryKey: ['motoristas'],
    queryFn: () => base44.entities.Motorista.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Motorista.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['motoristas']);
      handleCloseDialog();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Motorista.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['motoristas']);
      handleCloseDialog();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Motorista.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['motoristas']);
    }
  });

  const handleOpenDialog = (motorista = null) => {
    if (motorista) {
      setEditingMotorista(motorista);
      setFormData({
        nome: motorista.nome || '',
        cpf: motorista.cpf || '',
        telefone: motorista.telefone || '',
        ativo: motorista.ativo !== false
      });
    } else {
      setEditingMotorista(null);
      setFormData({
        nome: '',
        cpf: '',
        telefone: '',
        ativo: true
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingMotorista(null);
  };

  const handleSubmit = () => {
    if (editingMotorista) {
      updateMutation.mutate({ id: editingMotorista.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id) => {
    if (confirm('Tem certeza que deseja excluir este motorista?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleSubstituirPorLogados = async () => {
    if (!confirm('Isto irá deletar TODOS os motoristas atuais e substituir pelos logados nos veículos. Continuar?')) {
      return;
    }

    setIsSubstituindo(true);
    try {
      const result = await base44.functions.invoke('substituirMotoristasLogados', {});
      queryClient.invalidateQueries(['motoristas']);
      alert(`Motoristas substituídos com sucesso! ${result.data.motoristasSubstituidos} inseridos.`);
    } catch (error) {
      alert(`Erro: ${error.message}`);
    } finally {
      setIsSubstituindo(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Motoristas</h2>
          <p className="text-sm text-slate-600">Total: {motoristas.length}</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={handleSubstituirPorLogados}
            disabled={isSubstituindo}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isSubstituindo ? 'animate-spin' : ''}`} />
            Substituir por Logados
          </Button>
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="w-4 h-4 mr-2" />
            Novo Motorista
          </Button>
        </div>
      </div>

      <div className="grid gap-3">
        {motoristas.map((motorista, idx) => (
          <motion.div
            key={motorista.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.03 }}
          >
            <Card className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                <div className="flex items-center gap-3 col-span-2">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                    <User className="w-5 h-5 text-slate-600" />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800">{motorista.nome}</div>
                    <div className="text-xs text-slate-500">{motorista.cpf || '—'}</div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-slate-500">Telefone</div>
                  <div className="text-sm text-slate-700">{motorista.telefone || '—'}</div>
                </div>

                <div>
                  <div className="text-xs text-slate-500">Status</div>
                  <div className={`text-sm font-medium ${motorista.ativo ? 'text-green-600' : 'text-red-600'}`}>
                    {motorista.ativo ? 'Ativo' : 'Inativo'}
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleOpenDialog(motorista)}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(motorista.id)}
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
            <DialogTitle>{editingMotorista ? 'Editar Motorista' : 'Novo Motorista'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome Completo *</Label>
              <Input
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                placeholder="Ex: João da Silva"
              />
            </div>

            <div className="space-y-2">
              <Label>CPF</Label>
              <Input
                value={formData.cpf}
                onChange={(e) => setFormData({ ...formData, cpf: e.target.value })}
                placeholder="000.000.000-00"
              />
            </div>

            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input
                value={formData.telefone}
                onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                placeholder="(00) 00000-0000"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="ativo"
                checked={formData.ativo}
                onChange={(e) => setFormData({ ...formData, ativo: e.target.checked })}
                className="rounded"
              />
              <Label htmlFor="ativo" className="cursor-pointer">Motorista ativo</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit}>
              {editingMotorista ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}