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
    
    const url = `${BASE_URL}/v1/accounts/${ACCOUNT}/vehicles`;
    console.log("Requesting URL:", url);
    console.log("ACCOUNT:", ACCOUNT);
    console.log("BASE_URL:", BASE_URL);

    const res = await fetch(url, { headers: getAuthHeaders() });
    const text = await res.text();

    console.log("Status:", res.status);
    console.log("Response headers:", JSON.stringify(Object.fromEntries(res.headers.entries())));
    console.log("Response body:", text.substring(0, 2000));

    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}

    return Response.json({
      status: res.status,
      url,
      account: ACCOUNT,
      body: parsed || text.substring(0, 500)
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});