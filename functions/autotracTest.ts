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
    const base44 = createClientFromRequest(req);
    const results = [];

    // Primeiro: buscar veículos para pegar um autotrac_id real
    const vehiclesRes = await fetch(`${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles`, {
      headers: getAuthHeaders()
    });
    const vehiclesData = await vehiclesRes.json();
    const vehicles = Array.isArray(vehiclesData) ? vehiclesData : (vehiclesData.Data || vehiclesData.data || []);
    results.push({ step: 'vehicles', count: vehicles.length, sample: vehicles[0] });

    if (vehicles.length === 0) {
      return Response.json({ results, error: 'Sem veículos' });
    }

    const vehicleCode = vehicles[0].Code;
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const dateStart = yesterday.toISOString().split('T')[0];
    const dateEnd = now.toISOString().split('T')[0];

    // Testar endpoint returnmessages
    const url1 = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles/${vehicleCode}/returnmessages`;
    const res1 = await fetch(url1, { headers: getAuthHeaders() });
    const text1 = await res1.text();
    results.push({ endpoint: url1, status: res1.status, body: text1.substring(0, 1000) });

    // Testar com parâmetros de data
    const url2 = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles/${vehicleCode}/returnmessages?startDate=${dateStart}&endDate=${dateEnd}`;
    const res2 = await fetch(url2, { headers: getAuthHeaders() });
    const text2 = await res2.text();
    results.push({ endpoint: `returnmessages?startDate=${dateStart}&endDate=${dateEnd}`, status: res2.status, body: text2.substring(0, 1000) });

    // Testar /messages em vez de /returnmessages
    const url3 = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles/${vehicleCode}/messages`;
    const res3 = await fetch(url3, { headers: getAuthHeaders() });
    const text3 = await res3.text();
    results.push({ endpoint: 'messages', status: res3.status, body: text3.substring(0, 1000) });

    // Testar /macros
    const url4 = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles/${vehicleCode}/macros`;
    const res4 = await fetch(url4, { headers: getAuthHeaders() });
    const text4 = await res4.text();
    results.push({ endpoint: 'macros', status: res4.status, body: text4.substring(0, 1000) });

    // Testar /v1/accounts/{code}/returnmessages (nível de conta, não veículo)
    const url5 = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/returnmessages?startDate=${dateStart}&endDate=${dateEnd}`;
    const res5 = await fetch(url5, { headers: getAuthHeaders() });
    const text5 = await res5.text();
    results.push({ endpoint: `account-level returnmessages?date=${dateStart}`, status: res5.status, body: text5.substring(0, 1000) });

    return Response.json({ results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});