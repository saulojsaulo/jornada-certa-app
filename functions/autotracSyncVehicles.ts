import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");

const ACCOUNT_CODE = 10849;

function getAuthHeaders() {
  return {
    'Authorization': `Basic ${USER}:${PASS}`,
    'Ocp-Apim-Subscription-Key': API_KEY,
    'Content-Type': 'application/json'
  };
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

    // Buscar TODOS os veículos da Autotrac paginando (API retorna 10 por página)
    const PAGE_SIZE = 10;
    const vehicles = [];
    let offset = 0;

    while (true) {
      const res = await fetch(`${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles?limit=${PAGE_SIZE}&offset=${offset}`, {
        headers: getAuthHeaders()
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Falha ao buscar veículos: ${res.status} - ${text}`);
      }

      const data = await res.json();
      const page = Array.isArray(data) ? data : (data.Data || data.data || data.vehicles || []);
      vehicles.push(...page);

      if (data.IsLastPage === true || page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      if (offset >= 3000) break; // segurança

      await new Promise(r => setTimeout(r, 500));
    }

    // Buscar veículos já cadastrados no sistema
    const veiculosExistentes = await base44.asServiceRole.entities.Veiculo.list('-created_date', 5000);
    const existentesMap = {};
    for (const v of veiculosExistentes) {
      if (v.autotrac_id) existentesMap[String(v.autotrac_id)] = v;
    }

    let criados = 0;
    let atualizados = 0;

    // Processar em lotes para evitar timeout
    const BATCH = 20;
    for (let i = 0; i < vehicles.length; i += BATCH) {
      const lote = vehicles.slice(i, i + BATCH);

      await Promise.all(lote.map(async (vehicle) => {
        const autotracId = String(vehicle.Code || vehicle.code || '');
        const nomeVeiculo = vehicle.Name || vehicle.name || `Veículo ${autotracId}`;
        const placa = vehicle.LicensePlate || vehicle.licensePlate || vehicle.plate || '';
        const numeroFrota = vehicle.Address || vehicle.address || vehicle.TripName || '';

        if (!autotracId) return;

        if (existentesMap[autotracId]) {
          await base44.asServiceRole.entities.Veiculo.update(existentesMap[autotracId].id, {
            ativo: true,
            placa: placa || existentesMap[autotracId].placa,
          });
          atualizados++;
        } else {
          await base44.asServiceRole.entities.Veiculo.create({
            nome_veiculo: nomeVeiculo,
            placa: placa,
            numero_frota: numeroFrota,
            autotrac_id: autotracId,
            ativo: true
          });
          criados++;
        }
      }));

      // Pequeno delay entre lotes
      if (i + BATCH < vehicles.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    return Response.json({
      success: true,
      message: `Sincronização de veículos concluída. ${criados} criados, ${atualizados} atualizados.`,
      total_autotrac: vehicles.length,
      criados,
      atualizados
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});