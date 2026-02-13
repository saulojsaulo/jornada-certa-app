import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Plus, Pencil, Trash2, UserCog } from 'lucide-react';
import { motion } from 'framer-motion';

export default function GestoresTab() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingGestor, setEditingGestor] = useState(null);
  const [formData, setFormData] = useState({
    nome: '',
    email: '',
    telefone: '',
    ativo: true
  });

  const queryClient = useQueryClient();

  const { data: gestores = [] } = useQuery({
    queryKey: ['gestores'],
    queryFn: () => base44.entities.Gestor.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Gestor.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['gestores']);
      handleCloseDialog();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Gestor.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['gestores']);
      handleCloseDialog();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Gestor.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['gestores']);
    }
  });

  const handleOpenDialog = (gestor = null) => {
    if (gestor) {
      setEditingGestor(gestor);
      setFormData({
        nome: gestor.nome || '',
        email: gestor.email || '',
        telefone: gestor.telefone || '',
        ativo: gestor.ativo !== false
      });
    } else {
      setEditingGestor(null);
      setFormData({
        nome: '',
        email: '',
        telefone: '',
        ativo: true
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingGestor(null);
  };

  const handleSubmit = () => {
    if (editingGestor) {
      updateMutation.mutate({ id: editingGestor.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id) => {
    if (confirm('Tem certeza que deseja excluir este gestor?')) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Gestores</h2>
          <p className="text-sm text-slate-600">Total: {gestores.length}</p>
        </div>
        <Button onClick={() => handleOpenDialog()}>
          <Plus className="w-4 h-4 mr-2" />
          Novo Gestor
        </Button>
      </div>

      <div className="grid gap-3">
        {gestores.map((gestor, idx) => (
          <motion.div
            key={gestor.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.03 }}
          >
            <Card className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                <div className="flex items-center gap-3 col-span-2">
                  <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                    <UserCog className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800">{gestor.nome}</div>
                    <div className="text-xs text-slate-500">{gestor.email || '—'}</div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-slate-500">Telefone</div>
                  <div className="text-sm text-slate-700">{gestor.telefone || '—'}</div>
                </div>

                <div>
                  <div className="text-xs text-slate-500">Status</div>
                  <div className={`text-sm font-medium ${gestor.ativo ? 'text-green-600' : 'text-red-600'}`}>
                    {gestor.ativo ? 'Ativo' : 'Inativo'}
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleOpenDialog(gestor)}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(gestor.id)}
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
            <DialogTitle>{editingGestor ? 'Editar Gestor' : 'Novo Gestor'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                placeholder="Ex: Maria Santos"
              />
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="maria@example.com"
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
              <Label htmlFor="ativo" className="cursor-pointer">Gestor ativo</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit}>
              {editingGestor ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}