import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PROD_URL = 'https://aapi3.autotrac-online.com.br/aticapi';
const ACCOUNT_CODE = 10849;
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USERNAME = Deno.env.get("AUTOTRAC_USER");
const PASSWORD = Deno.env.get("AUTOTRAC_PASS");

function getHeaders() {
  return {
    'Authorization': `Basic ${USERNAME}:${PASSWORD}`,
    'Ocp-Apim-Subscription-Key': API_KEY,
    'Content-Type': 'application/json'
  };
}

async function getAllVehicles() {
  const allVehicles = [];
  let offset = 0;
  const limit = 100;
  
  while (true) {
    const url = `${PROD_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles?_limit=${limit}&_offset=${offset}`;
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) break;
    
    const data = await res.json();
    const vehicles = data.Data || [];
    
    if (vehicles.length === 0) break;
    allVehicles.push(...vehicles);
    
    if (vehicles.length < limit) break;
    
    offset += limit;
  }
  
  return allVehicles;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[SYNC] Buscando veículos da Autotrac...');
    const autotracVehicles = await getAllVehicles();
    console.log(`[SYNC] Total de veículos: ${autotracVehicles.length}`);

    // Buscar veículos existentes
    const localVehicles = await base44.entities.Veiculo.list(undefined, 500);
    const vehiclesByAutotracId = {};
    localVehicles.forEach(v => {
      if (v.autotrac_id) {
        vehiclesByAutotracId[String(v.autotrac_id)] = v.id;
      }
    });

    let created = 0;
    let updated = 0;

    // Separar em criar e atualizar
    const toCreate = [];
    const toUpdate = [];

    for (const vehicle of autotracVehicles) {
      const vehicleCode = String(vehicle.Code || vehicle.VehicleCode);
      const placa = vehicle.LicensePlate || '';
      const nome = vehicle.Name || `Veículo ${vehicleCode}`;

      if (vehiclesByAutotracId[vehicleCode]) {
        toUpdate.push({
          id: vehiclesByAutotracId[vehicleCode],
          autotrac_id: vehicleCode,
          placa: placa,
          nome_veiculo: nome
        });
      } else {
        toCreate.push({
          nome_veiculo: nome,
          placa: placa,
          autotrac_id: vehicleCode,
          ativo: true
        });
      }
    }

    // Bulk create com service role
    if (toCreate.length > 0) {
      console.log(`[SYNC] Criando ${toCreate.length} veículos...`);
      await base44.asServiceRole.entities.Veiculo.bulkCreate(toCreate);
      created = toCreate.length;
    }

    // Bulk update com service role em chunks
    if (toUpdate.length > 0) {
      console.log(`[SYNC] Atualizando ${toUpdate.length} veículos...`);
      const chunkSize = 50;
      for (let i = 0; i < toUpdate.length; i += chunkSize) {
        const chunk = toUpdate.slice(i, i + chunkSize);
        for (const v of chunk) {
          const { id, ...data } = v;
          await base44.asServiceRole.entities.Veiculo.update(id, data);
        }
        // Delay entre chunks
        if (i + chunkSize < toUpdate.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      updated = toUpdate.length;
    }

    console.log(`[SYNC] Criados: ${created}, Atualizados: ${updated}`);

    return Response.json({
      success: true,
      total_vehicles: autotracVehicles.length,
      created: created,
      updated: updated
    });
  } catch (error) {
    console.error('[SYNC] Erro:', error.message);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});