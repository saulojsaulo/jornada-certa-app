import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");

const ACCOUNT_CODE = 10849;
const PAGE_SIZE = 50; // Increased page size for efficiency

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
    
    // Buscar veículos existentes para deduplicação
    const veiculosExistentes = await base44.asServiceRole.entities.Veiculo.list('-created_date', 5000);
    const existentesMap = {};
    for (const v of veiculosExistentes) {
      if (v.autotrac_id) existentesMap[String(v.autotrac_id)] = v;
    }
    
    let criados = 0;
    let atualizados = 0;
    let offset = 0;
    let totalProcessados = 0;
    
    // Loop até acabar
    while (true) {
      const url = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles?limit=${PAGE_SIZE}&offset=${offset}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      
      if (!res.ok) {
        return Response.json({ error: `HTTP ${res.status} em offset ${offset}` }, { status: 500 });
      }
      
      const data = await res.json();
      const page = Array.isArray(data) ? data : (data.Data || data.data || []);
      
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
      
      if (data.IsLastPage === true || page.length === 0) {
        break;
      }
      
      offset += page.length;
      
      // Limit to 2000 vehicles to avoid timeout if infinite
      if (offset > 2000) break;
      
      await new Promise(r => setTimeout(r, 200)); // Pequeno delay
    }
    
    return Response.json({
      success: true,
      total_processados: totalProcessados,
      criados,
      atualizados
    });
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});