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

      // Passo 2: sincronizar macros — itera por janela de tempo (1h por vez) e por lote de veículos
      const HORAS_TOTAL = 24;
      setInfo(`Veículos: ${criados} novos. Buscando macros das últimas ${HORAS_TOTAL}h...`);

      let totalSaved = 0;
      let janelaOffset = 0; // começa da hora mais recente

      while (janelaOffset !== null && janelaOffset < HORAS_TOTAL) {
        // Para cada janela de 1h, iterar todos os lotes de veículos
        let offset = 0;
        let totalVeiculos = 0;

        while (true) {
          const macRes = await base44.functions.invoke('sincronizarMacros', {
            offset,
            horas: HORAS_TOTAL,
            janela_offset: janelaOffset,
          });
          const macResult = macRes.data?.results?.[0];

          if (macResult?.error) throw new Error(macResult.error);

          totalSaved += macResult?.saved || 0;
          totalVeiculos = macResult?.total_veiculos || 0;

          const horaInicio = HORAS_TOTAL - janelaOffset - 1;
          const horaFim = HORAS_TOTAL - janelaOffset;
          setInfo(`Janela ${horaInicio}-${horaFim}h atrás: ${macResult?.processados}/${totalVeiculos} veículos, ${totalSaved} macros salvas...`);

          if (!macResult?.proximo_offset) {
            // Avança para próxima janela de tempo
            janelaOffset = macResult?.proxima_janela_offset ?? null;
            break;
          }
          offset = macResult.proximo_offset;
        }
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