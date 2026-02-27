import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const AUTOTRAC_BASE_URL = Deno.env.get('AUTOTRAC_BASE_URL');
const AUTOTRAC_ACCOUNT = Deno.env.get('AUTOTRAC_ACCOUNT');
const AUTOTRAC_USER = Deno.env.get('AUTOTRAC_USER');
const AUTOTRAC_PASS = Deno.env.get('AUTOTRAC_PASS');
const AUTOTRAC_API_KEY = Deno.env.get('AUTOTRAC_API_KEY');

const VALID_MACROS = [1, 2, 3, 4, 5, 6];

function getHeaders() {
  const credentials = btoa(`${AUTOTRAC_USER}:${AUTOTRAC_PASS}`);
  return {
    'Authorization': `Basic ${credentials}`,
    'Ocp-Apim-Subscription-Key': AUTOTRAC_API_KEY,
    'Content-Type': 'application/json'
  };
}

async function getAllVehicles() {
  const vehicles = [];
  
  try {
    // Primeira requisição para pegar todos de uma vez
    const url = `${AUTOTRAC_BASE_URL}/v2/vehicles?pageSize=1000`;
    const response = await fetch(url, { headers: getHeaders() });
    
    if (!response.ok) {
      console.error(`[IMPORT] Erro ao buscar veículos: ${response.status}`);
      return vehicles;
    }
    
    const data = await response.json();
    
    if (data.list && Array.isArray(data.list)) {
      vehicles.push(...data.list);
      console.log(`[IMPORT] Total de ${vehicles.length} veículos buscados da Autotrac`);
    }
  } catch (err) {
    console.error(`[IMPORT] Erro ao buscar veículos: ${err.message}`);
  }

  return vehicles;
}

async function getVehicleMessages(vehicleCode) {
  // Buscar apenas últimas 48 horas
  const now = new Date();
  const last48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  
  const url = `${AUTOTRAC_BASE_URL}/v2/returnmessages/${vehicleCode}?pageSize=1000&startDate=${last48h.toISOString()}&endDate=${now.toISOString()}`;
  const response = await fetch(url, { headers: getHeaders() });
  return await response.json();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all vehicles from Autotrac
    const autotracVehicles = await getAllVehicles();

    // Fetch all existing macros in Base44
    const existingMacros = await base44.asServiceRole.entities.MacroEvento.list(undefined, 10000);
    const existingKeys = new Set(
      existingMacros.map(m => `${m.veiculo_id}-${m.numero_macro}-${new Date(m.data_criacao).toISOString()}`)
    );

    // Fetch all vehicles from Base44 for mapping
    const base44Vehicles = await base44.asServiceRole.entities.Veiculo.list(undefined, 500);
    const vehicleMap = {};
    base44Vehicles.forEach(v => {
      if (v.autotrac_id) {
        vehicleMap[String(v.autotrac_id)] = v;
      }
    });

    let createdCount = 0;
    let skippedCount = 0;
    const errors = [];

    // Process each vehicle
    console.log(`[IMPORT] Processando ${autotracVehicles.length} veículos...`);
    
    for (const autotracVehicle of autotracVehicles) {
      const vehicleCode = String(autotracVehicle.code);
      const base44Vehicle = vehicleMap[vehicleCode];

      if (!base44Vehicle) {
        skippedCount++;
        continue;
      }

      try {
        const messages = await getVehicleMessages(vehicleCode);
        console.log(`[IMPORT] ${vehicleCode}: ${messages.list?.length || 0} mensagens`);

        if (messages.list && Array.isArray(messages.list)) {
          // Batch criação de macros
          const macrosToCreate = [];
          
          for (const msg of messages.list) {
            if (!VALID_MACROS.includes(msg.macroNumber)) continue;

            const dataJornada = new Date(msg.messageTime).toISOString().split('T')[0];
            const key = `${base44Vehicle.id}-${msg.macroNumber}-${new Date(msg.messageTime).toISOString()}`;

            if (!existingKeys.has(key)) {
              macrosToCreate.push({
                veiculo_id: base44Vehicle.id,
                numero_macro: msg.macroNumber,
                data_criacao: msg.messageTime,
                jornada_id: `${base44Vehicle.id}-${dataJornada}-${new Date(msg.messageTime).getTime()}`,
                data_jornada: dataJornada
              });
              
              existingKeys.add(key);
            } else {
              skippedCount++;
            }
          }
          
          // Criar em batch
          if (macrosToCreate.length > 0) {
            await base44.asServiceRole.entities.MacroEvento.bulkCreate(macrosToCreate);
            createdCount += macrosToCreate.length;
            console.log(`[IMPORT] ${vehicleCode}: ${macrosToCreate.length} macros criadas`);
          }
        }
      } catch (err) {
        console.error(`[IMPORT] Erro em ${vehicleCode}: ${err.message}`);
        errors.push({ vehicle: vehicleCode, error: err.message });
      }
      
      // Delay para evitar rate limit
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    return Response.json({
      success: true,
      total_vehicles: autotracVehicles.length,
      created_macros: createdCount,
      skipped_macros: skippedCount,
      errors: errors
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});