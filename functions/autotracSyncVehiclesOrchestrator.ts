import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Orquestrador que chama autotracSyncVehicles em sequência com pause entre lotes
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    try {
      const user = await base44.auth.me();
      if (user?.role !== 'admin') {
        return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
      }
    } catch {
      // Automação agendada - OK
    }

    let offset = 0;
    let totalCriados = 0;
    let totalAtualizados = 0;
    let totalProcessados = 0;
    let rodadas = 0;
    const MAX_RODADAS = 50; // segurança: máx 5000 veículos

    while (rodadas < MAX_RODADAS) {
      const res = await base44.functions.invoke('autotracSyncVehicles', { offset });
      const data = res.data;

      if (!data.success) {
        return Response.json({ error: `Erro na rodada ${rodadas}: ${data.error || JSON.stringify(data)}` }, { status: 500 });
      }

      totalCriados += data.criados || 0;
      totalAtualizados += data.atualizados || 0;
      totalProcessados += data.total_processados || 0;
      rodadas++;

      if (data.concluido) break;

      offset = data.next_offset;

      // Esperar 3 segundos entre lotes para respeitar rate limit
      await new Promise(r => setTimeout(r, 3000));
    }

    return Response.json({
      success: true,
      message: `Sincronização total concluída em ${rodadas} rodada(s). ${totalCriados} criados, ${totalAtualizados} atualizados.`,
      total_processados: totalProcessados,
      criados: totalCriados,
      atualizados: totalAtualizados
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});