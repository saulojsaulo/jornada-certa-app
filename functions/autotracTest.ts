import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");

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

    // Buscar todas as páginas de veículos
    let offset = 0;
    const pageSize = 10;
    let totalVehicles = [];
    let page = 0;

    while (true) {
      const url = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles?limit=${pageSize}&offset=${offset}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.Data || data.data || []);

      totalVehicles.push(...items);
      results.push({ page, offset, count: items.length, isLastPage: data.IsLastPage });

      page++;
      offset += pageSize;

      // Parar se IsLastPage === true ou sem itens ou muitas páginas (segurança)
      if (data.IsLastPage === true || items.length === 0 || page >= 40) break;
    }

    return Response.json({ 
      total_vehicles: totalVehicles.length,
      pages_fetched: page,
      results,
      sample_vehicles: totalVehicles.slice(0, 3).map(v => ({ Code: v.Code, Name: v.Name }))
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});