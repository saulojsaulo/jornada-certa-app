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

    // Testar paginação de veículos com limit/offset
    const url1 = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles?limit=100&offset=0`;
    const res1 = await fetch(url1, { headers: getAuthHeaders() });
    const data1 = await res1.json();
    const page1 = Array.isArray(data1) ? data1 : (data1.Data || data1.data || []);
    results.push({ test: 'vehicles?limit=100&offset=0', status: res1.status, count: page1.length, isLastPage: data1.IsLastPage, raw_keys: Object.keys(data1) });

    // Testar com offset=10
    const url2 = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles?limit=100&offset=10`;
    const res2 = await fetch(url2, { headers: getAuthHeaders() });
    const data2 = await res2.json();
    const page2 = Array.isArray(data2) ? data2 : (data2.Data || data2.data || []);
    results.push({ test: 'vehicles?limit=100&offset=10', status: res2.status, count: page2.length, isLastPage: data2.IsLastPage });

    // Testar sem limit (default)
    const url3 = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles`;
    const res3 = await fetch(url3, { headers: getAuthHeaders() });
    const data3 = await res3.json();
    const page3 = Array.isArray(data3) ? data3 : (data3.Data || data3.data || []);
    results.push({ test: 'vehicles (no params)', status: res3.status, count: page3.length, isLastPage: data3.IsLastPage, total: data3.Total || data3.total });

    return Response.json({ results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});