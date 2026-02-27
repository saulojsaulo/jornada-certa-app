import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const veiculoId = body.veiculoId;
    
    if (!veiculoId) {
      return Response.json({ error: 'veiculoId é obrigatório' }, { status: 400 });
    }
    
    const veiculo = await base44.asServiceRole.entities.Veiculo.get(veiculoId);
    
    if (!veiculo?.autotrac_id) {
      return Response.json({ error: 'Veículo sem autotrac_id' }, { status: 400 });
    }
    
    // Buscar macros deste veículo específico via API Autotrac
    const agora = new Date();
    const inicio48h = new Date(agora.getTime() - 48 * 60 * 60 * 1000);
    
    function fmtDate(d) {
      return d.toISOString().replace('T', ' ').substring(0, 19);
    }
    
    function getAuthHeaders() {
      return {
        'Authorization': `Basic ${USER}:${PASS}`,
        'Ocp-Apim-Subscription-Key': API_KEY,
        'Content-Type': 'application/json'
      };
    }
    
    const startDateStr = fmtDate(inicio48h);
    const endDateStr = fmtDate(agora);
    const ACCOUNT_CODE = 10849;
    
    let allMensagens = [];
    let offset = 0;
    const limit = 50;
    
    while (true) {
      const url = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles/${veiculo.autotrac_id}/returnmessages` +
        `?startDate=${encodeURIComponent(startDateStr)}&endDate=${encodeURIComponent(endDateStr)}` +
        `&limit=${limit}&offset=${offset}`;
      
      const res = await fetch(url, { headers: getAuthHeaders() });
      
      if (!res.ok) {
        const text = await res.text();
        return Response.json({ 
          error: `HTTP ${res.status}`, 
          details: text.substring(0, 200),
          url: url
        }, { status: 500 });
      }
      
      const data = await res.json();
      const page = data.Data || data.data || (Array.isArray(data) ? data : []);
      allMensagens = allMensagens.concat(page);
      
      if (data.IsLastPage === true || page.length < limit) break;
      offset += limit;
      
      if (offset >= limit * 10) break; // Max 10 páginas
    }
    
    // Filtrar apenas macros válidas
    const MACROS_VALIDAS = [1, 2, 3, 4, 5, 6, 9, 10];
    const macrosValidas = allMensagens.filter(m => 
      m.MacroNumber !== null && 
      m.MacroNumber !== undefined && 
      MACROS_VALIDAS.includes(m.MacroNumber)
    );
    
    return Response.json({
      veiculo: veiculo.nome_veiculo,
      autotrac_id: veiculo.autotrac_id,
      total_mensagens: allMensagens.length,
      macros_validas: macrosValidas.length,
      sample: macrosValidas.slice(0, 5).map(m => ({
        MacroNumber: m.MacroNumber,
        MessageTime: m.MessageTime,
        MessageText: m.MessageText
      }))
    });
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

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
    const results = [];

    // Buscar apenas as primeiras 5 páginas de veículos com delay de 1s entre cada
    const PAGE_SIZE = 10;
    const vehicles = [];

    for (let i = 0; i < 5; i++) {
      const offset = i * PAGE_SIZE;
      const url = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles?limit=${PAGE_SIZE}&offset=${offset}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      const data = await res.json();
      const page = Array.isArray(data) ? data : (data.Data || data.data || []);
      vehicles.push(...page);
      results.push({ page: i, offset, count: page.length, isLastPage: data.IsLastPage, status: res.status });

      if (data.IsLastPage === true || page.length < PAGE_SIZE) break;

      // delay de 1 segundo
      await new Promise(r => setTimeout(r, 1000));
    }

    return Response.json({
      total: vehicles.length,
      results,
      sample: vehicles.slice(0, 3).map(v => ({ Code: v.Code, Name: v.Name }))
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});