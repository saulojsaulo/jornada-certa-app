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

    const credB64 = btoa(`${USER}:${PASS}`);

    // Testar account code 10849 (Cocal Cereais)
    const accountCode = 10849;

    // Variação 1: GET /v1/accounts/10849/vehicles com Basic Auth btoa
    const url1 = `${BASE_URL}/v1/accounts/${accountCode}/vehicles`;
    const res1 = await fetch(url1, {
      headers: {
        'Authorization': `Basic ${credB64}`,
        'Ocp-Apim-Subscription-Key': API_KEY,
      }
    });
    const text1 = await res1.text();
    results.push({ variant: `GET /v1/accounts/${accountCode}/vehicles - Basic btoa`, status: res1.status, body: text1.substring(0, 500) });

    // Variação 2: GET /v1/accounts/10849/vehicles sem Authorization
    const res2 = await fetch(url1, {
      headers: { 'Ocp-Apim-Subscription-Key': API_KEY }
    });
    const text2 = await res2.text();
    results.push({ variant: 'Without Authorization header', status: res2.status, body: text2.substring(0, 500) });

    // Variação 3: Usar ACCOUNT env var diretamente
    const url3 = `${BASE_URL}/v1/accounts/${ACCOUNT}/vehicles`;
    const res3 = await fetch(url3, {
      headers: {
        'Authorization': `Basic ${credB64}`,
        'Ocp-Apim-Subscription-Key': API_KEY,
      }
    });
    const text3 = await res3.text();
    results.push({ variant: `GET /v1/accounts/${ACCOUNT}/vehicles (ACCOUNT env)`, status: res3.status, body: text3.substring(0, 500) });

    // Variação 4: GET /v2/accounts/10849/vehicles (testar v2)
    const url4 = `${BASE_URL}/v2/accounts/${accountCode}/vehicles`;
    const res4 = await fetch(url4, {
      headers: {
        'Authorization': `Basic ${credB64}`,
        'Ocp-Apim-Subscription-Key': API_KEY,
      }
    });
    const text4 = await res4.text();
    results.push({ variant: 'v2 endpoint', status: res4.status, body: text4.substring(0, 500) });

    // Info sobre os env vars (sem revelar senhas)
    results.push({ 
      info: 'env_vars', 
      BASE_URL, 
      ACCOUNT, 
      USER, 
      API_KEY_length: API_KEY?.length,
      PASS_length: PASS?.length
    });

    return Response.json({ results });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});