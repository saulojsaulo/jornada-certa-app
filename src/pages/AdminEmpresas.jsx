import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { Plus, Building2, Mail, Star, Pencil, Trash2, Users, CheckCircle, XCircle, Wifi } from 'lucide-react';
import ApiRastreamentoForm from '../components/empresas/ApiRastreamentoForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const PLANO_LABELS = { free: 'Free', basic: 'Basic', premium: 'Premium' };
const PLANO_COLORS = {
  free: 'bg-slate-100 text-slate-700',
  basic: 'bg-blue-100 text-blue-700',
  premium: 'bg-amber-100 text-amber-700',
};

const EMPTY_FORM = { nome: '', contato_email: '', plano_assinatura: 'free', ativa: true, provedora_rastreamento: null, api_config: {} };

export default function AdminEmpresas() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEmpresa, setEditingEmpresa] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmpresa, setInviteEmpresa] = useState(null);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'company_user' });

  const { data: empresas = [], isLoading } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => base44.entities.Empresa.list('-created_date'),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Empresa.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['empresas'] }); closeDialog(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Empresa.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['empresas'] }); closeDialog(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Empresa.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['empresas'] }),
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingEmpresa(null);
    setForm(EMPTY_FORM);
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingEmpresa(null);
    setDialogOpen(true);
  };

  const openEdit = (empresa) => {
    setForm({
      nome: empresa.nome || '',
      contato_email: empresa.contato_email || '',
      plano_assinatura: empresa.plano_assinatura || 'free',
      ativa: empresa.ativa ?? true,
      provedora_rastreamento: empresa.provedora_rastreamento || null,
      api_config: empresa.api_config || {},
    });
    setEditingEmpresa(empresa);
    setDialogOpen(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingEmpresa) {
      updateMutation.mutate({ id: editingEmpresa.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    await base44.users.inviteUser(inviteForm.email, inviteForm.role);
    // Após convite, o admin deve manualmente setar company_id no usuário via lista de usuários
    setInviteDialogOpen(false);
    setInviteForm({ email: '', role: 'company_user' });
    alert(`Convite enviado para ${inviteForm.email}. Após o cadastro, vincule o usuário à empresa na gestão de usuários.`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
              <Building2 className="w-8 h-8 text-emerald-600" />
              Administração de Empresas
            </h1>
            <p className="text-slate-500 mt-1">Gerencie todas as empresas clientes do SaaS</p>
          </div>
          <Button onClick={openCreate} className="bg-emerald-600 hover:bg-emerald-700 gap-2">
            <Plus className="w-4 h-4" />
            Nova Empresa
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card>
            <CardContent className="pt-6 flex items-center gap-4">
              <Building2 className="w-8 h-8 text-emerald-600" />
              <div>
                <div className="text-2xl font-bold text-slate-800">{empresas.length}</div>
                <div className="text-sm text-slate-500">Total de Empresas</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-center gap-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
              <div>
                <div className="text-2xl font-bold text-slate-800">{empresas.filter(e => e.ativa !== false).length}</div>
                <div className="text-sm text-slate-500">Empresas Ativas</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-center gap-4">
              <Star className="w-8 h-8 text-amber-600" />
              <div>
                <div className="text-2xl font-bold text-slate-800">{empresas.filter(e => e.plano_assinatura === 'premium').length}</div>
                <div className="text-sm text-slate-500">Planos Premium</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Lista de Empresas */}
        {isLoading ? (
          <div className="text-center py-12 text-slate-400">Carregando...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {empresas.map((empresa, idx) => (
              <motion.div
                key={empresa.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <Card className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base truncate">{empresa.nome}</CardTitle>
                        <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
                          <Mail className="w-3 h-3" />
                          <span className="truncate">{empresa.contato_email}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        {empresa.ativa !== false ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400" />
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center justify-between">
                      <Badge className={PLANO_COLORS[empresa.plano_assinatura] || PLANO_COLORS.free}>
                        <Star className="w-3 h-3 mr-1" />
                        {PLANO_LABELS[empresa.plano_assinatura] || 'Free'}
                      </Badge>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-blue-500"
                          onClick={() => { setInviteEmpresa(empresa); setInviteDialogOpen(true); }}
                          title="Convidar usuário"
                        >
                          <Users className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEdit(empresa)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-400"
                          onClick={() => {
                            if (confirm(`Excluir empresa "${empresa.nome}"?`)) deleteMutation.mutate(empresa.id);
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                      <p className="text-xs text-slate-400 font-mono truncate">ID: {empresa.id}</p>
                      {empresa.provedora_rastreamento && (
                        <Badge className="bg-emerald-50 text-emerald-700 text-xs gap-1">
                          <Wifi className="w-3 h-3" />
                          {empresa.provedora_rastreamento}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Dialog Criar/Editar */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingEmpresa ? 'Editar Empresa' : 'Nova Empresa'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Nome da Empresa *</Label>
              <Input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} required />
            </div>
            <div>
              <Label>E-mail de Contato *</Label>
              <Input type="email" value={form.contato_email} onChange={e => setForm(f => ({ ...f, contato_email: e.target.value }))} required />
            </div>
            <div>
              <Label>Plano de Assinatura</Label>
              <Select value={form.plano_assinatura} onValueChange={v => setForm(f => ({ ...f, plano_assinatura: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="basic">Basic</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.ativa} onCheckedChange={v => setForm(f => ({ ...f, ativa: v }))} />
              <Label>Empresa ativa</Label>
            </div>

            <ApiRastreamentoForm
              provedora={form.provedora_rastreamento}
              onChangeProvedora={v => setForm(f => ({ ...f, provedora_rastreamento: v }))}
              apiConfig={form.api_config}
              onChangeApiConfig={v => setForm(f => ({ ...f, api_config: v }))}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeDialog}>Cancelar</Button>
              <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700">
                {editingEmpresa ? 'Salvar' : 'Criar Empresa'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog Convidar Usuário */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar Usuário — {inviteEmpresa?.nome}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleInvite} className="space-y-4">
            <div>
              <Label>E-mail do usuário *</Label>
              <Input type="email" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} required />
            </div>
            <div>
              <Label>Papel (Role)</Label>
              <Select value={inviteForm.role} onValueChange={v => setInviteForm(f => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="company_admin">Admin da Empresa</SelectItem>
                  <SelectItem value="company_user">Usuário</SelectItem>
                  <SelectItem value="viewer">Visualizador</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-slate-400">
              O usuário receberá um e-mail de convite. Após o primeiro acesso, vincule-o à empresa <strong>{inviteEmpresa?.nome}</strong>.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setInviteDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700">Enviar Convite</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}