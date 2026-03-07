import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Truck, LayoutDashboard, ClipboardList, Building2, Users,
  ChevronDown, LogOut, Menu, X, Shield
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const queryClient = new QueryClient();

const NAV_ITEMS = [
  { label: 'Jornada', page: 'Jornada', icon: Truck },
  { label: 'Cadastros', page: 'Cadastros', icon: ClipboardList },
  { label: 'Dashboard', page: 'Dashboard', icon: LayoutDashboard },
];

const ADMIN_NAV_ITEMS = [
  { label: 'Empresas', page: 'AdminEmpresas', icon: Building2 },
  { label: 'Usuários', page: 'AdminUsuarios', icon: Users },
];

const PLANO_COLORS = {
  free: 'bg-slate-100 text-slate-600',
  basic: 'bg-blue-100 text-blue-700',
  premium: 'bg-amber-100 text-amber-800',
};

function LayoutInner({ children, currentPageName }) {
  const [user, setUser] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState(() =>
    localStorage.getItem('admin_selected_company') || null
  );

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const isAdmin = user?.role === 'admin';
  const isCompanyAdmin = user?.role === 'company_admin';

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => base44.entities.Empresa.list(),
    enabled: isAdmin,
  });

  const activeCompanyId = isAdmin ? selectedCompanyId : user?.company_id;
  const activeEmpresa = empresas.find(e => e.id === activeCompanyId);

  const handleSelectCompany = (id) => {
    setSelectedCompanyId(id);
    localStorage.setItem('admin_selected_company', id);
  };

  // Páginas de admin puro não mostram nav de empresa
  const isAdminPage = ['AdminEmpresas', 'AdminUsuarios'].includes(currentPageName);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Topbar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-screen-xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Truck className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-800 hidden sm:block">JornadaFrota</span>
            {isAdmin && (
              <Badge className="bg-red-100 text-red-700 text-xs hidden sm:flex items-center gap-1">
                <Shield className="w-3 h-3" /> Admin
              </Badge>
            )}
          </div>

          {/* Nav desktop */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map(({ label, page, icon: Icon }) => (
              <Link key={page} to={createPageUrl(page)}>
                <Button
                  variant={currentPageName === page ? 'default' : 'ghost'}
                  size="sm"
                  className={cn('gap-2', currentPageName === page && 'bg-emerald-600 hover:bg-emerald-700')}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </Button>
              </Link>
            ))}
            {(isAdmin || isCompanyAdmin) && (
              <div className="w-px h-5 bg-slate-200 mx-1" />
            )}
            {isAdmin && ADMIN_NAV_ITEMS.map(({ label, page, icon: Icon }) => (
              <Link key={page} to={createPageUrl(page)}>
                <Button
                  variant={currentPageName === page ? 'default' : 'ghost'}
                  size="sm"
                  className={cn('gap-2', currentPageName === page && 'bg-slate-800 hover:bg-slate-900')}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </Button>
              </Link>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* Seletor de empresa (admin) */}
            {isAdmin && !isAdminPage && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2 max-w-[200px]">
                    <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="truncate text-xs">
                      {activeEmpresa ? activeEmpresa.nome : 'Selecionar empresa'}
                    </span>
                    <ChevronDown className="w-3 h-3 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {empresas.map(e => (
                    <DropdownMenuItem
                      key={e.id}
                      onClick={() => handleSelectCompany(e.id)}
                      className={cn('gap-2', activeCompanyId === e.id && 'font-semibold bg-emerald-50')}
                    >
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                      <span className="truncate">{e.nome}</span>
                      {e.plano_assinatura && (
                        <Badge className={cn('ml-auto text-xs', PLANO_COLORS[e.plano_assinatura])}>
                          {e.plano_assinatura}
                        </Badge>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Info empresa (company_admin/user) */}
            {!isAdmin && activeEmpresa && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-lg">
                <Building2 className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-xs text-slate-700 font-medium">{activeEmpresa.nome}</span>
              </div>
            )}

            {/* User menu */}
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-xs font-bold">
                      {(user.full_name || user.email || '?')[0].toUpperCase()}
                    </div>
                    <span className="hidden sm:block text-sm max-w-[100px] truncate">{user.full_name || user.email}</span>
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <div className="px-3 py-2">
                    <div className="text-sm font-medium">{user.full_name}</div>
                    <div className="text-xs text-slate-500 truncate">{user.email}</div>
                    <Badge className={cn('mt-1 text-xs', user.role === 'admin' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700')}>
                      {user.role || 'company_user'}
                    </Badge>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => base44.auth.logout()} className="text-red-600 gap-2">
                    <LogOut className="w-4 h-4" />
                    Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Mobile menu toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(o => !o)}
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile nav */}
        {mobileOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-1">
            {NAV_ITEMS.map(({ label, page, icon: Icon }) => (
              <Link key={page} to={createPageUrl(page)} onClick={() => setMobileOpen(false)}>
                <Button
                  variant={currentPageName === page ? 'default' : 'ghost'}
                  size="sm"
                  className={cn('w-full justify-start gap-2', currentPageName === page && 'bg-emerald-600')}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </Button>
              </Link>
            ))}
            {isAdmin && (
              <>
                <div className="h-px bg-slate-200 my-2" />
                {ADMIN_NAV_ITEMS.map(({ label, page, icon: Icon }) => (
                  <Link key={page} to={createPageUrl(page)} onClick={() => setMobileOpen(false)}>
                    <Button
                      variant={currentPageName === page ? 'default' : 'ghost'}
                      size="sm"
                      className="w-full justify-start gap-2"
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </Button>
                  </Link>
                ))}
              </>
            )}
          </div>
        )}
      </header>

      {/* Content */}
      <main className="max-w-screen-xl mx-auto">
        {children}
      </main>
    </div>
  );
}

export default function Layout({ children, currentPageName }) {
  return (
    <QueryClientProvider client={queryClient}>
      <LayoutInner currentPageName={currentPageName}>
        {children}
      </LayoutInner>
    </QueryClientProvider>
  );
}