import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");

const ACCOUNT_CODE = 10849;
const PAGE_SIZE = 10;

function getAuthHeaders() {
  return {
    'Authorization': `Basic ${USER}:${PASS}`,
    'Ocp-Apim-Subscription-Key': API_KEY,
    'Content-Type': 'application/json'
  };
}

// Busca uma única página de veículos da Autotrac
async function fetchPage(offset) {
  const res = await fetch(`${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles?limit=${PAGE_SIZE}&offset=${offset}`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar veículos offset=${offset}`);
  const data = await res.json();
  const page = Array.isArray(data) ? data : (data.Data || data.data || data.vehicles || []);
  return { page, isLastPage: data.IsLastPage === true || page.length < PAGE_SIZE };
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

    // Ler o offset salvo (para continuar de onde parou, ou iniciar do zero)
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

    // Processar até 10 páginas por execução (100 veículos) para não dar timeout
    const MAX_PAGES_PER_RUN = 10;

    for (let p = 0; p < MAX_PAGES_PER_RUN; p++) {
      const { page, isLastPage } = await fetchPage(offset);

      for (const vehicle of page) {
        const autotracId = String(vehicle.Code || vehicle.code || '');
        if (!autotracId) continue;

        const nomeVeiculo = vehicle.Name || vehicle.name || `Veículo ${autotracId}`;
        const placa = vehicle.LicensePlate || vehicle.licensePlate || vehicle.plate || '';
        const numeroFrota = vehicle.Address || vehicle.address || vehicle.TripName || '';

        if (existentesMap[autotracId]) {
          await base44.asServiceRole.entities.Veiculo.update(existentesMap[autotracId].id, {
            ativo: true,
            placa: placa || existentesMap[autotracId].placa,
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
      }

      totalProcessados += page.length;
      offset += PAGE_SIZE;

      if (isLastPage) {
        // Concluído!
        return Response.json({
          success: true,
          concluido: true,
          message: `Sincronização concluída. ${criados} criados, ${atualizados} atualizados.`,
          total_processados: totalProcessados,
          criados,
          atualizados
        });
      }

      await new Promise(r => setTimeout(r, 800));
    }

    // Ainda há páginas, retornar próximo offset para continuar
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