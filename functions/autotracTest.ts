import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const veiculos = await base44.asServiceRole.entities.Veiculo.list('-created_date', 5000);
    return Response.json({ count: veiculos.length });
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