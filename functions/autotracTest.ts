import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const ACCOUNT = Deno.env.get("AUTOTRAC_ACCOUNT");

function getAuthHeaders() {
  const credentials = btoa(`${USER}:${PASS}`);
  return {
    'Authorization': `Basic ${credentials}`,
    'x-api-key': API_KEY,
    'Ocp-Apim-Subscription-Key': API_KEY,
    'Content-Type': 'application/json'
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Testar múltiplas variações
    const results = [];

    // Variação 1: GET /vehicles sem query params
    const url1 = `${BASE_URL}/v1/accounts/${ACCOUNT}/vehicles`;
    const res1 = await fetch(url1, { headers: getAuthHeaders() });
    const text1 = await res1.text();
    results.push({ variant: 'v1 GET vehicles', status: res1.status, body: text1.substring(0, 300) });

    // Variação 2: GET /vehicles com isActive=true
    const url2 = `${BASE_URL}/v1/accounts/${ACCOUNT}/vehicles?isActive=true`;
    const res2 = await fetch(url2, { headers: getAuthHeaders() });
    const text2 = await res2.text();
    results.push({ variant: 'v1 GET vehicles?isActive=true', status: res2.status, body: text2.substring(0, 300) });

    // Variação 3: Testar authorized-units endpoint (mencionado no manual)
    const url3 = `${BASE_URL}/v1/accounts/${ACCOUNT}/authorized-units`;
    const res3 = await fetch(url3, { headers: getAuthHeaders() });
    const text3 = await res3.text();
    results.push({ variant: 'v1 authorized-units', status: res3.status, body: text3.substring(0, 300) });

    // Variação 4: Usar apikey como query param
    const url4 = `${BASE_URL}/v1/accounts/${ACCOUNT}/vehicles?subscription-key=${API_KEY}`;
    const res4 = await fetch(url4, { headers: { 'Authorization': `Basic ${btoa(`${USER}:${PASS}`)}`, 'Content-Type': 'application/json' } });
    const text4 = await res4.text();
    results.push({ variant: 'apikey as query param', status: res4.status, body: text4.substring(0, 300) });

    console.log("Results:", JSON.stringify(results, null, 2));

    return Response.json({ results });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});