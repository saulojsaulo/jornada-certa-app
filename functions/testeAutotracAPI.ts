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

    // Teste 1: Sem pageSize
    const url1 = `${AUTOTRAC_BASE_URL}/v2/vehicles`;
    console.log(`[DEBUG] Teste 1: ${url1}`);
    const response1 = await fetch(url1, { headers: getHeaders() });
    const data1 = await response1.json();
    console.log(`[DEBUG] Resposta 1: ${JSON.stringify(data1).substring(0, 300)}`);

    // Teste 2: Com pageSize
    const url2 = `${AUTOTRAC_BASE_URL}/v2/vehicles?pageSize=100`;
    console.log(`[DEBUG] Teste 2: ${url2}`);
    const response2 = await fetch(url2, { headers: getHeaders() });
    const data2 = await response2.json();
    console.log(`[DEBUG] Resposta 2: ${JSON.stringify(data2).substring(0, 300)}`);

    return Response.json({
      test1: { status: response1.status, vehicles: data1.list?.length || 0 },
      test2: { status: response2.status, vehicles: data2.list?.length || 0 }
    });
  } catch (error) {
    console.error(`[DEBUG] Erro: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});