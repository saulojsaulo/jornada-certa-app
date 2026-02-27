import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const ACCOUNT = Deno.env.get("AUTOTRAC_ACCOUNT");

async function getAutotracToken() {
  const credentials = btoa(`${USER}:${PASS}`);
  const res = await fetch(`${BASE_URL}/v1/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'x-api-key': API_KEY,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Autotrac auth failed: ${res.status} - ${text}`);
  }

  const data = await res.json();
  // Retorna o token de acesso (campo pode variar - tentamos vários)
  return data.access_token || data.token || data.accessToken || data;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Autenticação - aceitar chamadas de automação (sem usuário) ou de admin
    let isAutomation = false;
    try {
      const user = await base44.auth.me();
      if (user?.role !== 'admin') {
        return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
      }
    } catch {
      // Chamada via automação agendada (sem usuário autenticado)
      isAutomation = true;
    }

    // 1. Obter token Autotrac
    const token = await getAutotracToken();

    // 2. Buscar veículos ativos da conta
    const vehiclesRes = await fetch(`${BASE_URL}/v1/accounts/${ACCOUNT}/vehicles`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-api-key': API_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!vehiclesRes.ok) {
      const text = await vehiclesRes.text();
      throw new Error(`Falha ao buscar veículos: ${vehiclesRes.status} - ${text}`);
    }

    const vehiclesData = await vehiclesRes.json();
    const vehicles = Array.isArray(vehiclesData) ? vehiclesData : (vehiclesData.vehicles || vehiclesData.data || []);

    // 3. Buscar veículos já cadastrados no sistema
    const veiculosExistentes = await base44.asServiceRole.entities.Veiculo.list();
    const existentesMap = {};
    for (const v of veiculosExistentes) {
      if (v.autotrac_id) existentesMap[String(v.autotrac_id)] = v;
    }

    let criados = 0;
    let atualizados = 0;

    for (const vehicle of vehicles) {
      const autotracId = String(vehicle.id || vehicle.vehicleId || vehicle.vehicle_id || '');
      const nomeVeiculo = vehicle.name || vehicle.plate || vehicle.description || `Veículo ${autotracId}`;
      const placa = vehicle.plate || vehicle.licensePlate || '';
      const numeroFrota = vehicle.fleetNumber || vehicle.fleet_number || vehicle.fleet || '';

      if (!autotracId) continue;

      if (existentesMap[autotracId]) {
        // Atualizar veículo existente
        await base44.asServiceRole.entities.Veiculo.update(existentesMap[autotracId].id, {
          ativo: true,
          placa: placa || existentesMap[autotracId].placa,
        });
        atualizados++;
      } else {
        // Criar novo veículo
        await base44.asServiceRole.entities.Veiculo.create({
          nome_veiculo: nomeVeiculo,
          placa: placa,
          numero_frota: numeroFrota,
          autotrac_id: autotracId,
          ativo: true
        });
        criados++;
      }
    }

    return Response.json({
      success: true,
      message: `Sincronização concluída. ${criados} criados, ${atualizados} atualizados.`,
      total: vehicles.length,
      criados,
      atualizados
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});