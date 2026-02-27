import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// URL de produção correta conforme documentação
const PROD_URL = 'https://aapi3.autotrac-online.com.br/aticapi';
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const ACCOUNT_CODE = 10849;
const PAGE_SIZE = 10;

function getHeaders() {
  return {
    'Authorization': `Basic ${USER}:${PASS}`,
    'Ocp-Apim-Subscription-Key': API_KEY,
    'Content-Type': 'application/json'
  };
}

async function fetchPage(offset) {
  const url = `${PROD_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles?limit=${PAGE_SIZE}&offset=${offset}`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar veículos offset=${offset}`);
  const data = await res.json();
  // Resposta vem em data.Data (array)
  const page = data.Data || (Array.isArray(data) ? data : []);
  const isLastPage = data.IsLastPage === true || page.length < PAGE_SIZE;
  return { page, isLastPage };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    try {
      const user = await base44.auth.me();
      if (user?.role !== 'admin') {
        return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
      }
    } catch {
      // Automação agendada sem usuário - OK
    }

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const startOffset = body.offset ?? 0;

    // Buscar veículos já cadastrados para deduplicação
    const veiculosExistentes = await base44.asServiceRole.entities.Veiculo.list('-created_date', 5000);
    const existentesMap = {};
    for (const v of veiculosExistentes) {
      if (v.autotrac_id) existentesMap[String(v.autotrac_id)] = v;
    }

    let criados = 0;
    let atualizados = 0;
    let offset = startOffset;
    let totalProcessados = 0;
    const MAX_PAGES_PER_RUN = 10;

    for (let p = 0; p < MAX_PAGES_PER_RUN; p++) {
      const { page, isLastPage } = await fetchPage(offset);

      for (const vehicle of page) {
        // Code = identificador interno da API (usado para buscar mensagens)
        // Address = número único do equipamento (ex: 280207)
        const autotracId = String(vehicle.Code || '');
        if (!autotracId) continue;

        const nomeVeiculo = vehicle.Name || `Veículo ${autotracId}`;
        const placa = vehicle.LicensePlate || '';
        const numeroFrota = vehicle.Address ? String(vehicle.Address) : '';

        if (existentesMap[autotracId]) {
          await base44.asServiceRole.entities.Veiculo.update(existentesMap[autotracId].id, {
            ativo: true,
            placa: placa || existentesMap[autotracId].placa,
            numero_frota: numeroFrota || existentesMap[autotracId].numero_frota,
          });
          atualizados++;
        } else {
          await base44.asServiceRole.entities.Veiculo.create({
            nome_veiculo: nomeVeiculo,
            placa,
            numero_frota: numeroFrota,
            autotrac_id: autotracId,
            ativo: true
          });
          criados++;
        }
        await new Promise(r => setTimeout(r, 50));
      }

      totalProcessados += page.length;
      offset += PAGE_SIZE;

      if (isLastPage) {
        return Response.json({
          success: true,
          concluido: true,
          message: `Sincronização concluída. ${criados} criados, ${atualizados} atualizados.`,
          total_processados: totalProcessados,
          criados,
          atualizados
        });
      }

      await new Promise(r => setTimeout(r, 500));
    }

    return Response.json({
      success: true,
      concluido: false,
      message: `Parcial: ${totalProcessados} veículos processados. Continue com offset=${offset}.`,
      next_offset: offset,
      total_processados: totalProcessados,
      criados,
      atualizados
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});