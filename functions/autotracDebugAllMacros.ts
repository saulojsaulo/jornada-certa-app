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
    
    // Se retornou menos do que o limite, chegou ao final
    if (vehicles.length < limit) break;
    
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

function isWithin48Hours(messageTimeStr) {
  if (!messageTimeStr) return false;
  try {
    const msgDate = new Date(messageTimeStr);
    const now = new Date();
    const diffMs = Math.abs(now - msgDate);
    const diffHours = diffMs / (60 * 60 * 1000);
    return diffHours <= 48;
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

    console.log('[DEBUG] Buscando todos os 229 veículos...');
    const autotracVehicles = await getAllVehicles();
    console.log(`[DEBUG] Total de veículos: ${autotracVehicles.length}`);

    const allMacros = [];
    let processedCount = 0;

    for (const vehicle of autotracVehicles) {
      const vehicleCode = String(vehicle.Code || vehicle.VehicleCode);
      processedCount++;

      try {
        const messages = await getVehicleMessages(parseInt(vehicleCode));
        
        // Filtrar mensagens das últimas 48 horas
        const last48hMessages = messages.filter(msg => isWithin48Hours(msg.MessageTime));

        if (last48hMessages.length > 0) {
          const macrosForThisVehicle = last48hMessages.map(msg => ({
            veiculo_code: vehicleCode,
            veiculo_nome: vehicle.Name || vehicle.LicensePlate || vehicleCode,
            placa: vehicle.LicensePlate || 'N/A',
            numero_macro: msg.MacroNumber,
            data_criacao: msg.MessageTime,
            raw: JSON.stringify(msg)
          }));

          allMacros.push(...macrosForThisVehicle);
        }
      } catch (err) {
        console.log(`[DEBUG] Erro ao buscar macros do veículo ${vehicleCode}: ${err.message}`);
      }
    }

    return Response.json({
      success: true,
      total_vehicles: autotracVehicles.length,
      processed_vehicles: processedCount,
      total_macros: allMacros.length,
      macros: allMacros
    });
  } catch (error) {
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});