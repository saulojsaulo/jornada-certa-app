import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const ACCOUNT = Deno.env.get("AUTOTRAC_ACCOUNT");

function getAuthHeaders() {
  const credentials = btoa(`${USER}:${PASS}`);
  return {
    'Authorization': `Basic ${credentials}`,
    'Ocp-Apim-Subscription-Key': API_KEY,
    'Content-Type': 'application/json'
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Aceitar chamadas de automação agendada ou de admin
    try {
      const user = await base44.auth.me();
      if (user?.role !== 'admin') {
        return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
      }
    } catch {
      // Automação agendada sem usuário - OK
    }

    // Cocal Cereais = Code 10849 (ignorar Cedro Transportes Code 11007)
    const accountCode = 10849;

    // Buscar veículos ativos da conta
    const vehiclesRes = await fetch(`${BASE_URL}/v1/accounts/${accountCode}/vehicles`, {
      headers: getAuthHeaders()
    });

    if (!vehiclesRes.ok) {
      const text = await vehiclesRes.text();
      throw new Error(`Falha ao buscar veículos: ${vehiclesRes.status} - ${text}`);
    }

    const vehiclesData = await vehiclesRes.json();
    const vehicles = Array.isArray(vehiclesData) ? vehiclesData : (vehiclesData.vehicles || vehiclesData.data || []);

    // Buscar veículos já cadastrados no sistema
    const veiculosExistentes = await base44.asServiceRole.entities.Veiculo.list();
    const existentesMap = {};
    for (const v of veiculosExistentes) {
      if (v.autotrac_id) existentesMap[String(v.autotrac_id)] = v;
    }

    let criados = 0;
    let atualizados = 0;

    for (const vehicle of vehicles) {
      const autotracId = String(vehicle.Code || vehicle.code || '');
      const nomeVeiculo = vehicle.Name || vehicle.name || `Veículo ${autotracId}`;
      const placa = vehicle.LicensePlate || vehicle.licensePlate || vehicle.plate || '';
      const numeroFrota = vehicle.Address || vehicle.address || vehicle.TripName || '';

      if (!autotracId) continue;

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
    }

    return Response.json({
      success: true,
      message: `Sincronização concluída. ${criados} criados, ${atualizados} atualizados.`,
      total: vehicles.length,
      criados,
      atualizados,
      raw_sample: vehicles.slice(0, 2) // Para debug da estrutura da resposta
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});