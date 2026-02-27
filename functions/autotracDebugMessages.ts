import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PROD_URL = 'https://aapi3.autotrac-online.com.br/aticapi';
const ACCOUNT_CODE = 10849;
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USERNAME = Deno.env.get("AUTOTRAC_USER");
const PASSWORD = Deno.env.get("AUTOTRAC_PASS");

function getHeaders() {
  return {
    'Authorization': `Basic ${USERNAME}:${PASSWORD}`,
    'Ocp-Apim-Subscription-Key': API_KEY,
    'Content-Type': 'application/json'
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Testar um veículo específico
    const vehicleCode = 731123;
    const url = `${PROD_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles/${vehicleCode}/returnmessages`;
    
    const res = await fetch(url, { headers: getHeaders() });
    const responseText = await res.text();
    
    return Response.json({
      url,
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type'),
        'content-length': res.headers.get('content-length')
      },
      bodyPreview: responseText.substring(0, 500),
      bodyLength: responseText.length,
      parsed: (() => {
        try {
          return JSON.parse(responseText);
        } catch {
          return { error: 'Could not parse JSON' };
        }
      })()
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});