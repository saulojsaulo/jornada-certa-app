import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PROD_URL = 'https://aapi3.autotrac-online.com.br/aticapi';
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const ACCOUNT_CODE = 10849;
const PAGE_SIZE = 50;

function getHeaders() {
  return {
    'Authorization': `Basic ${USER}:${PASS}`,
    'Ocp-Apim-Subscription-Key': API_KEY,
    'Content-Type': 'application/json'
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const allVehicles = [];
    let offset = 0;

    // Paginar até buscar todos os veículos
    while (true) {
      const url = `${PROD_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles?limit=${PAGE_SIZE}&offset=${offset}`;
      const res = await fetch(url, { headers: getHeaders() });

      if (!res.ok) {
        return Response.json({ error: `HTTP ${res.status}` }, { status: 500 });
      }

      const data = await res.json();
      const page = data.Data || [];
      allVehicles.push(...page);

      if (data.IsLastPage === true || page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      
      await new Promise(r => setTimeout(r, 300));
    }

    return Response.json({
      success: true,
      total: allVehicles.length,
      vehicles: allVehicles.map(v => ({
        id: `temp_${v.Code}`,
        autotrac_id: String(v.Code),
        nome_veiculo: v.Name || `Veículo ${v.Code}`,
        placa: v.LicensePlate || '',
        numero_frota: String(v.Address || ''),
        ativo: true,
        created_date: new Date().toISOString(),
        updated_date: new Date().toISOString()
      }))
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});