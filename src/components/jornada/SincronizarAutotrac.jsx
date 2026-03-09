import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

export default function SincronizarAutotrac({ onSyncComplete, selectedDate }) {
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [info, setInfo] = useState('');

  // Sincroniza um dia inteiro em uma única chamada bulk à API
  const syncDia = async (dateStr, label) => {
    const from = new Date(`${dateStr}T03:00:00.000Z`); // 00:00 BRT
    const to   = new Date(from.getTime() + 24 * 3600 * 1000 - 1); // 23:59:59 BRT

    let offset = 0;
    let totalSaved = 0;
    let lote = 1;

    while (true) {
      const macRes = await base44.functions.invoke('sincronizarMacros', {
        offset,
        from_iso: from.toISOString(),
        to_iso: to.toISOString(),
      });
      const macResult = macRes.data?.results?.[0];
      if (macResult?.error) throw new Error(macResult.error);
      totalSaved += macResult?.saved || 0;
      setInfo(`${label} - lote ${lote}: ${macResult?.processados}/${macResult?.total_veiculos} veículos, ${totalSaved} macros salvas...`);
      if (!macResult?.proximo_offset) break;
      offset = macResult.proximo_offset;
      lote++;
    }
    return totalSaved;
  };

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

      // Determinar datas a sincronizar
      const hoje = new Date();
      const hojeStr = hoje.toISOString().split('T')[0];

      let datas = [];
      if (selectedDate) {
        // Sincroniza o dia selecionado + o dia anterior (para interjornada)
        const sel = new Date(selectedDate);
        const selStr = sel.toISOString().split('T')[0];
        const antStr = new Date(sel.getTime() - 86400000).toISOString().split('T')[0];
        datas = selStr === hojeStr ? [selStr] : [antStr, selStr];
      } else {
        // Sem data específica: sincroniza hoje e ontem
        const ontemStr = new Date(hoje.getTime() - 86400000).toISOString().split('T')[0];
        datas = [ontemStr, hojeStr];
      }

      let totalSaved = 0;
      for (const d of datas) {
        setInfo(`Sincronizando ${d}...`);
        totalSaved += await syncDia(d, d);
      }

      setStatus('done');
      setInfo(`Concluído: ${criados} veículos novos, ${totalSaved} macros salvas.`);
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