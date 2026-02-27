import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PROD_URL = Deno.env.get("AUTOTRAC_BASE_URL");
const ACCOUNT_CODE = Deno.env.get("AUTOTRAC_ACCOUNT");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USERNAME = Deno.env.get("AUTOTRAC_USER");
const PASSWORD = Deno.env.get("AUTOTRAC_PASS");

const VALID_MACROS = [1, 2, 3, 4, 5, 6, 9, 10];

function getHeaders() {
  const auth = btoa(`${USERNAME}:${PASSWORD}`);
  return {
    'Authorization': `Basic ${auth}`,
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json'
  };
}

async function getAllVehicles() {
  let allVehicles = [];
  let offset = 0;
  const limit = 500;
  
  while (true) {
    const url = `${PROD_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles?offset=${offset}&_limit=${limit}`;
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) break;
    
    const data = await res.json();
    const vehicles = data.Data || [];
    if (vehicles.length === 0) break;
    
    allVehicles = allVehicles.concat(vehicles);
    offset += limit;
  }
  
  return allVehicles;
}

async function getVehicleMessages(vehicleCode) {
  const url = `${PROD_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles/${vehicleCode}/returnmessages`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) return [];
  
  const data = await res.json();
  return data.Data || [];
}

function isWithinLast48Hours(messageTimeStr) {
  if (!messageTimeStr) return false;
  try {
    const msgDate = new Date(messageTimeStr);
    const now = new Date();
    const diffMs = now - msgDate;
    const diff48h = 48 * 60 * 60 * 1000;
    return diffMs >= 0 && diffMs <= diff48h;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Buscar todos os veículos
    const autotracVehicles = await getAllVehicles();
    console.log(`Total de veículos na Autotrac: ${autotracVehicles.length}`);

    // Buscar veículos já cadastrados no banco
    const localVehicles = await base44.entities.Veiculo.list('', 5000);
    const vehicleMap = {};
    localVehicles.forEach(v => {
      if (v.autotrac_id) {
        vehicleMap[v.autotrac_id] = v.id;
      }
    });

    // Buscar macros já existentes para evitar duplicação
    const existingMacros = await base44.entities.MacroEvento.list('', 50000);
    const existingKeys = new Set();
    existingMacros.forEach(m => {
      const key = `${m.veiculo_id}-${m.numero_macro}-${new Date(m.data_criacao).toISOString().split('.')[0]}`;
      existingKeys.add(key);
    });

    // Processar cada veículo
    const results = {
      total_vehicles: autotracVehicles.length,
      processed: 0,
      macros_created: 0,
      macros_skipped: 0,
      errors: []
    };

    for (const vehicle of autotracVehicles) {
      const vehicleCode = vehicle.VehicleCode;
      const veiculoId = vehicleMap[vehicleCode];
      
      if (!veiculoId) {
        continue; // Pular se veículo não existir no banco
      }

      try {
        const messages = await getVehicleMessages(vehicleCode);
        
        // Filtrar: apenas macros válidas e últimas 48h
        const validMessages = messages.filter(msg => {
          const macro = msg.MacroNumber;
          if (!VALID_MACROS.includes(macro)) return false;
          return isWithinLast48Hours(msg.MessageTime);
        });

        // Criar registros no banco
        const macrosToCreate = [];
        for (const msg of validMessages) {
          const data_criacao = msg.MessageTime;
          const data_jornada = new Date(data_criacao).toISOString().split('T')[0];
          const key = `${veiculoId}-${msg.MacroNumber}-${new Date(data_criacao).toISOString().split('.')[0]}`;
          
          if (!existingKeys.has(key)) {
            macrosToCreate.push({
              veiculo_id: veiculoId,
              numero_macro: msg.MacroNumber,
              data_criacao: data_criacao,
              data_jornada: data_jornada
            });
            existingKeys.add(key);
          } else {
            results.macros_skipped++;
          }
        }

        // Bulk create se houver macros para criar
        if (macrosToCreate.length > 0) {
          await base44.entities.MacroEvento.bulkCreate(macrosToCreate);
          results.macros_created += macrosToCreate.length;
        }

        results.processed++;
      } catch (err) {
        results.errors.push({
          vehicle: vehicleCode,
          error: err.message
        });
      }
    }

    return Response.json({
      success: true,
      ...results
    });
  } catch (error) {
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});