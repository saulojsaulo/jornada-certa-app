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

    // Testar com pageSize maior: 50, 100, 200, 500
    for (const pageSize of [50, 100, 200, 500]) {
      const url = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles?limit=${pageSize}&offset=0`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.Data || data.data || []);
      results.push({ pageSize, status: res.status, count: items.length, isLastPage: data.IsLastPage, limit: data.Limit });
    }

    return Response.json({ results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});