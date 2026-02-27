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
    'x-api-key': API_KEY,
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

    // Buscar veículos ativos da conta
    const vehiclesRes = await fetch(`${BASE_URL}/v1/accounts/${ACCOUNT}/vehicles`, {
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
      const autotracId = String(vehicle.id || vehicle.vehicleId || vehicle.vehicle_id || '');
      const nomeVeiculo = vehicle.name || vehicle.plate || vehicle.description || `Veículo ${autotracId}`;
      const placa = vehicle.plate || vehicle.licensePlate || vehicle.license_plate || '';
      const numeroFrota = vehicle.fleetNumber || vehicle.fleet_number || vehicle.fleet || '';

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