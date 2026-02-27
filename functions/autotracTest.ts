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
    
    const results = [];

    // Buscar lista de contas para descobrir o Code correto
    const accountsRes = await fetch(`${BASE_URL}/v1/accounts`, {
      headers: {
        'Authorization': `Basic ${USER}:${PASS}`,
        'Ocp-Apim-Subscription-Key': API_KEY,
        'Content-Type': 'application/json'
      }
    });
    const accountsText = await accountsRes.text();
    results.push({ endpoint: '/v1/accounts', status: accountsRes.status, body: accountsText.substring(0, 1000) });

    // Variação 1: Basic Auth com apikey no header Ocp-Apim-Subscription-Key
    const credB64 = btoa(`${USER}:${PASS}`);
    const url1 = `${BASE_URL}/v1/accounts/${ACCOUNT}/vehicles`;
    const res1 = await fetch(url1, {
      headers: {
        'Authorization': `Basic ${credB64}`,
        'Ocp-Apim-Subscription-Key': API_KEY,
      }
    });
    const text1 = await res1.text();
    results.push({ variant: 'Basic Auth + Ocp-Apim-Subscription-Key', status: res1.status, headers: Object.fromEntries(res1.headers.entries()), body: text1.substring(0, 500) });

    // Variação 2: Apenas API Key no header
    const res2 = await fetch(url1, {
      headers: {
        'Ocp-Apim-Subscription-Key': API_KEY,
      }
    });
    const text2 = await res2.text();
    results.push({ variant: 'Only Ocp-Apim-Subscription-Key', status: res2.status, body: text2.substring(0, 500) });

    // Variação 3: Bearer token com apikey
    const res3 = await fetch(url1, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Ocp-Apim-Subscription-Key': API_KEY,
      }
    });
    const text3 = await res3.text();
    results.push({ variant: 'Bearer API_KEY + Ocp-Apim', status: res3.status, body: text3.substring(0, 500) });

    // Variação 4: query param subscription-key
    const url4 = `${BASE_URL}/v1/accounts/${ACCOUNT}/vehicles?subscription-key=${API_KEY}`;
    const res4 = await fetch(url4, {
      headers: { 'Authorization': `Basic ${credB64}` }
    });
    const text4 = await res4.text();
    results.push({ variant: 'subscription-key as query + Basic', status: res4.status, body: text4.substring(0, 500) });

    return Response.json({ results });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});