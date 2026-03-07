import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { Users, Building2, Shield, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ROLE_LABELS = {
  admin: 'Super Admin',
  company_admin: 'Admin Empresa',
  company_user: 'Usuário',
  viewer: 'Visualizador',
};

const ROLE_COLORS = {
  admin: 'bg-red-100 text-red-700',
  company_admin: 'bg-purple-100 text-purple-700',
  company_user: 'bg-blue-100 text-blue-700',
  viewer: 'bg-slate-100 text-slate-700',
};

export default function AdminUsuarios() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: usuarios = [], isLoading: loadingUsuarios } = useQuery({
    queryKey: ['usuarios'],
    queryFn: () => base44.entities.User.list(),
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => base44.entities.Empresa.list(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.auth.updateMe(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['usuarios'] }),
  });

  const empresaMap = Object.fromEntries(empresas.map(e => [e.id, e.nome]));

  const filtered = usuarios.filter(u =>
    (u.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleUpdateUser = (userId, field, value) => {
    base44.asServiceRole?.entities?.User?.update(userId, { [field]: value })
      .then(() => queryClient.invalidateQueries({ queryKey: ['usuarios'] }))
      .catch(console.error);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
              <Users className="w-8 h-8 text-blue-600" />
              Gestão de Usuários
            </h1>
            <p className="text-slate-500 mt-1">Vincule usuários às empresas e gerencie permissões</p>
          </div>
        </div>

        {/* Busca */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome ou e-mail..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {loadingUsuarios ? (
          <div className="text-center py-12 text-slate-400">Carregando...</div>
        ) : (
          <div className="space-y-3">
            {filtered.map((user, idx) => (
              <motion.div
                key={user.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.03 }}
              >
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex flex-col md:flex-row md:items-center gap-3">
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-800">{user.full_name || '—'}</div>
                        <div className="text-sm text-slate-500">{user.email}</div>
                      </div>

                      {/* Role */}
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-slate-400" />
                        <Select
                          value={user.role || 'company_user'}
                          onValueChange={v => handleUpdateUser(user.id, 'role', v)}
                        >
                          <SelectTrigger className="w-40 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Super Admin</SelectItem>
                            <SelectItem value="company_admin">Admin Empresa</SelectItem>
                            <SelectItem value="company_user">Usuário</SelectItem>
                            <SelectItem value="viewer">Visualizador</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Empresa */}
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-slate-400" />
                        <Select
                          value={user.company_id || '__none__'}
                          onValueChange={v => handleUpdateUser(user.id, 'company_id', v === '__none__' ? null : v)}
                        >
                          <SelectTrigger className="w-52 h-8 text-xs">
                            <SelectValue placeholder="Sem empresa" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— Sem empresa —</SelectItem>
                            {empresas.map(e => (
                              <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Badge status */}
                      <Badge className={ROLE_COLORS[user.role] || ROLE_COLORS.company_user}>
                        {ROLE_LABELS[user.role] || 'Usuário'}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-12 text-slate-400">Nenhum usuário encontrado</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}