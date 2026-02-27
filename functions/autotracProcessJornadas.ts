import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PROD_URL = 'https://aapi3.autotrac-online.com.br/aticapi';
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const ACCOUNT_CODE = 10849;
const PAGE_SIZE = 500;

function getHeaders() {
  return {
    'Authorization': `Basic ${USER}:${PASS}`,
    'Ocp-Apim-Subscription-Key': API_KEY,
    'Content-Type': 'application/json'
  };
}

async function getAllVehicles() {
  const allVehicles = [];
  let offset = 0;

  while (true) {
    const url = `${PROD_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles?_limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) break;
    
    const data = await res.json();
    const page = data.Data || [];
    allVehicles.push(...page);
    
    if (data.IsLastPage === true || page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    await new Promise(r => setTimeout(r, 200));
  }

  return allVehicles;
}

async function getVehicleMessages(vehicleCode) {
  const url = `${PROD_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles/${vehicleCode}/returnmessages`;
  try {
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) return [];
    
    const data = await res.json();
    const messages = data.Data || [];

    const now = new Date();
    const validMessages = messages.filter(msg => {
      const macro = msg.MacroNumber;
      if (![1, 2, 3, 4, 5, 6, 9, 10].includes(macro)) return false;
      
      try {
        const msgDate = new Date(msg.MessageTime);
        const diffMs = now - msgDate;
        return diffMs >= 0 && diffMs <= 48 * 60 * 60 * 1000;
      } catch {
        return false;
      }
    });

    return validMessages.map(msg => ({
      macroNumber: msg.MacroNumber,
      messageTime: msg.MessageTime,
      landmark: msg.Landmark || ''
    }));
  } catch {
    return [];
  }
}

function calculateJornadas(messages) {
  const jornadas = [];
  
  // Agrupar por data de macro 1
  const messagesByDate = {};
  
  messages.forEach(msg => {
    if (!msg.createdDate) return;
    const date = new Date(msg.createdDate).toISOString().split('T')[0];
    if (!messagesByDate[date]) messagesByDate[date] = [];
    messagesByDate[date].push(msg);
  });

  // Processar cada jornada
  Object.entries(messagesByDate).forEach(([date, dayMessages]) => {
    const sortedMsgs = dayMessages.sort((a, b) => 
      new Date(a.createdDate) - new Date(b.createdDate)
    );

    if (sortedMsgs.length === 0) return;

    const macro1 = sortedMsgs.find(m => m.macroNumber === 1);
    const macro2 = sortedMsgs.find(m => m.macroNumber === 2);

    if (!macro1) return;

    const startTime = new Date(macro1.createdDate);
    const endTime = macro2 ? new Date(macro2.createdDate) : new Date();
    const durationMs = endTime - startTime;
    const durationHours = durationMs / (1000 * 60 * 60);

    jornadas.push({
      data: date,
      inicio: macro1.createdDate,
      fim: macro2?.createdDate || null,
      duracao_bruta: Math.round(durationHours * 100) / 100,
      macros: sortedMsgs.map(m => ({
        numero: m.macroNumber,
        horario: m.createdDate,
        descricao: m.description
      }))
    });
  });

  return jornadas;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const vehicles = await getAllVehicles();
    const result = [];
    let processed = 0;

    for (const vehicle of vehicles) {
      const vehicleCode = parseInt(vehicle.Code);
      const messages = await getVehicleMessages(vehicleCode);
      const jornadas = calculateJornadas(messages);

      result.push({
        vehicleCode,
        veiculoNome: vehicle.Name || `Veículo ${vehicleCode}`,
        placa: vehicle.LicensePlate || '',
        jornadas,
        total_mensagens: messages.length,
        total_jornadas: jornadas.length
      });

      processed++;
      if (processed % 10 === 0) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return Response.json({
      success: true,
      total_veiculos: vehicles.length,
      veiculos_processados: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});