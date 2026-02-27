import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const ACCOUNT = Deno.env.get("AUTOTRAC_ACCOUNT");

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const results = [];
    const credB64 = btoa(`${USER}:${PASS}`);
    const accountCode = 10849;

    // Auth estilo 1: sem btoa (igual ao /v1/accounts que funcionou)
    const res1 = await fetch(`${BASE_URL}/v1/accounts/${accountCode}/vehicles`, {
      headers: {
        'Authorization': `Basic ${USER}:${PASS}`,
        'Ocp-Apim-Subscription-Key': API_KEY,
        'Content-Type': 'application/json'
      }
    });
    const text1 = await res1.text();
    results.push({ variant: 'SEM btoa (igual accounts que funcionou)', status: res1.status, body: text1.substring(0, 800) });

    // Auth estilo 2: com btoa
    const res2 = await fetch(`${BASE_URL}/v1/accounts/${accountCode}/vehicles`, {
      headers: {
        'Authorization': `Basic ${credB64}`,
        'Ocp-Apim-Subscription-Key': API_KEY,
      }
    });
    const text2 = await res2.text();
    results.push({ variant: 'COM btoa', status: res2.status, body: text2.substring(0, 800) });

    // Testar /v1/accounts/10849/units (pode ser diferente de vehicles)
    const res3 = await fetch(`${BASE_URL}/v1/accounts/${accountCode}/units`, {
      headers: {
        'Authorization': `Basic ${USER}:${PASS}`,
        'Ocp-Apim-Subscription-Key': API_KEY,
      }
    });
    const text3 = await res3.text();
    results.push({ variant: 'GET /v1/accounts/10849/units', status: res3.status, body: text3.substring(0, 800) });

    // Testar /v1/units direto
    const res4 = await fetch(`${BASE_URL}/v1/units`, {
      headers: {
        'Authorization': `Basic ${USER}:${PASS}`,
        'Ocp-Apim-Subscription-Key': API_KEY,
      }
    });
    const text4 = await res4.text();
    results.push({ variant: 'GET /v1/units (direto)', status: res4.status, body: text4.substring(0, 800) });

    // Testar /v1/vehicles direto
    const res5 = await fetch(`${BASE_URL}/v1/vehicles`, {
      headers: {
        'Authorization': `Basic ${USER}:${PASS}`,
        'Ocp-Apim-Subscription-Key': API_KEY,
      }
    });
    const text5 = await res5.text();
    results.push({ variant: 'GET /v1/vehicles (direto)', status: res5.status, body: text5.substring(0, 800) });

    // Testar /v1/accounts/10849 (info da conta)
    const res6 = await fetch(`${BASE_URL}/v1/accounts/${accountCode}`, {
      headers: {
        'Authorization': `Basic ${USER}:${PASS}`,
        'Ocp-Apim-Subscription-Key': API_KEY,
      }
    });
    const text6 = await res6.text();
    results.push({ variant: 'GET /v1/accounts/10849 (info da conta)', status: res6.status, body: text6.substring(0, 800) });

    // Testar /v1/accounts/10849/messages (em vez de vehicles)
    const now = new Date();
    const yesterday = new Date(now - 86400000);
    const dateStr = yesterday.toISOString().split('T')[0];
    const res7 = await fetch(`${BASE_URL}/v1/accounts/${accountCode}/messages?startDate=${dateStr}&endDate=${dateStr}`, {
      headers: {
        'Authorization': `Basic ${USER}:${PASS}`,
        'Ocp-Apim-Subscription-Key': API_KEY,
      }
    });
    const text7 = await res7.text();
    results.push({ variant: `GET /v1/accounts/10849/messages?date=${dateStr}`, status: res7.status, body: text7.substring(0, 800) });

    results.push({ info: 'env', BASE_URL, USER, ACCOUNT, API_KEY_len: API_KEY?.length, PASS_len: PASS?.length });

    return Response.json({ results });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});