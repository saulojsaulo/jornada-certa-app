import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
  } catch {}

  const usuario = Deno.env.get('AUTOTRAC_USER');
  const senha   = Deno.env.get('AUTOTRAC_PASS');
  const apiKey  = Deno.env.get('AUTOTRAC_API_KEY');
  const accountCode = 10849; // Code retornado pela API para a conta 268532276

  const headers = {
    'Authorization': `Basic ${usuario}:${senha}`,
    'Ocp-Apim-Subscription-Key': apiKey,
    'Content-Type': 'application/json',
    'User-Agent': 'PostmanRuntime/7.37.0',
    'Cache-Control': 'no-cache',
  };

  const results = {};

  // Testar variações do endpoint de veículos
  const endpoints = [
    `/accounts/${accountCode}/vehicles`,
    `/accounts/${accountCode}/vehicles?_limit=500`,
    `/accounts/${accountCode}/vehicles?status=active`,
    `/accounts/${accountCode}/vehicles?active=true`,
    `/accounts/${accountCode}/vehicles?_limit=500&status=active`,
    `/vehicles?account=${accountCode}&_limit=50`,
  ];

  const BASE_URL = 'https://aapi3.autotrac-online.com.br/aticapi/v1';

  for (const endpoint of endpoints) {
    const url = BASE_URL + endpoint;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeout);
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      results[endpoint] = {
        status: res.status,
        type: Array.isArray(data) ? `array[${data.length}]` : typeof data,
        sample: Array.isArray(data) ? data.slice(0, 2) : (typeof data === 'object' ? data : text.substring(0, 200)),
      };
    } catch (e) {
      results[endpoint] = { error: e.message };
    }
  }

  return Response.json({ results });
});