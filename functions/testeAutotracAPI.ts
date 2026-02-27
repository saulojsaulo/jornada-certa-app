import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const AUTOTRAC_BASE_URL = Deno.env.get('AUTOTRAC_BASE_URL');
const AUTOTRAC_USER = Deno.env.get('AUTOTRAC_USER');
const AUTOTRAC_PASS = Deno.env.get('AUTOTRAC_PASS');
const AUTOTRAC_API_KEY = Deno.env.get('AUTOTRAC_API_KEY');

function getHeaders() {
  const credentials = btoa(`${AUTOTRAC_USER}:${AUTOTRAC_PASS}`);
  return {
    'Authorization': `Basic ${credentials}`,
    'Ocp-Apim-Subscription-Key': AUTOTRAC_API_KEY,
    'Content-Type': 'application/json'
  };
}

Deno.serve(async (req) => {
  try {
    console.log(`[DEBUG] BASE_URL: ${AUTOTRAC_BASE_URL}`);
    console.log(`[DEBUG] USER: ${AUTOTRAC_USER}`);
    console.log(`[DEBUG] API_KEY existe: ${!!AUTOTRAC_API_KEY}`);

    const url = `${AUTOTRAC_BASE_URL}/v2/vehicles?pageSize=1000`;
    console.log(`[DEBUG] Fazendo request para: ${url}`);

    const response = await fetch(url, { headers: getHeaders() });
    console.log(`[DEBUG] Status: ${response.status}`);

    const data = await response.json();
    console.log(`[DEBUG] Resposta: ${JSON.stringify(data).substring(0, 500)}`);

    return Response.json({
      status: response.status,
      total_vehicles: data.list?.length || 0,
      debug: data
    });
  } catch (error) {
    console.error(`[DEBUG] Erro: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});