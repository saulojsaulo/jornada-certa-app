import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

export default function SincronizarAutotrac({ onSyncComplete }) {
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [info, setInfo] = useState('');

  const handleSync = async () => {
    setStatus('running');
    setInfo('Iniciando sincronização...');

    try {
      // Passo 1: sincronizar veículos da Autotrac
      setInfo('Buscando veículos na Autotrac...');
      const veicRes = await base44.functions.invoke('sincronizarVeiculos', {});
      const veicResult = veicRes.data?.results?.[0];
      if (veicResult?.error) throw new Error(veicResult.error);

      const criados = veicResult?.criados || 0;

      // Passo 2: sincronizar macros em lotes
      setInfo(`Veículos: ${criados} novos. Buscando macros...`);

      let offset = 0;
      let totalSaved = 0;
      let totalProcessados = 0;

      while (true) {
        const macRes = await base44.functions.invoke('sincronizarMacros', { offset, horas: 24 });
        const macResult = macRes.data?.results?.[0];

        if (macResult?.error) throw new Error(macResult.error);

        totalSaved += macResult?.saved || 0;
        totalProcessados += macResult?.processados || 0;
        const total = macResult?.total_veiculos || 0;

        setInfo(`Macros: ${totalProcessados}/${total} veículos processados, ${totalSaved} eventos salvos...`);

        if (!macResult?.proximo_offset) break;
        offset = macResult.proximo_offset;
      }

      setStatus('done');
      setInfo(`Sincronização concluída: ${criados} veículos novos, ${totalSaved} macros salvas.`);
      if (onSyncComplete) onSyncComplete();

    } catch (e) {
      setStatus('error');
      setInfo(e.message);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={handleSync}
        disabled={status === 'running'}
        variant={status === 'error' ? 'destructive' : 'outline'}
        size="sm"
        className="gap-2 whitespace-nowrap"
      >
        {status === 'running' ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : status === 'done' ? (
          <CheckCircle className="w-4 h-4 text-emerald-500" />
        ) : status === 'error' ? (
          <AlertCircle className="w-4 h-4" />
        ) : (
          <RefreshCw className="w-4 h-4" />
        )}
        Sincronizar Autotrac
      </Button>
      {info && (
        <span className="text-xs text-slate-500 max-w-[300px] truncate" title={info}>
          {info}
        </span>
      )}
    </div>
  );
}