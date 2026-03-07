import React, { createContext, useContext, useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';

const CompanyContext = createContext(null);

export function CompanyProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);

  useEffect(() => {
    base44.auth.me().then(user => {
      setCurrentUser(user);
      // Admin pode selecionar empresa; outros são fixados à sua empresa
      if (user?.role !== 'admin') {
        setSelectedCompanyId(user?.company_id || null);
      } else {
        // Admin: recupera última empresa selecionada do localStorage
        const saved = localStorage.getItem('admin_selected_company');
        if (saved) setSelectedCompanyId(saved);
      }
      setLoadingUser(false);
    }).catch(() => setLoadingUser(false));
  }, []);

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => base44.entities.Empresa.list(),
    enabled: currentUser?.role === 'admin',
  });

  const activeCompanyId = selectedCompanyId;

  const selectCompany = (companyId) => {
    setSelectedCompanyId(companyId);
    if (currentUser?.role === 'admin') {
      localStorage.setItem('admin_selected_company', companyId);
    }
  };

  const isAdmin = currentUser?.role === 'admin';
  const isCompanyAdmin = currentUser?.role === 'company_admin';
  const canManage = isAdmin || isCompanyAdmin;

  return (
    <CompanyContext.Provider value={{
      currentUser,
      loadingUser,
      activeCompanyId,
      selectCompany,
      empresas,
      isAdmin,
      isCompanyAdmin,
      canManage,
    }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  return useContext(CompanyContext);
}