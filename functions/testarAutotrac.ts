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

  // Testar endpoint de mensagens por conta (sem precisar iterar por veículo)
  const now  = new Date();
  const from = new Date(now - 3 * 60 * 60 * 1000); // últimas 3h
  const fmt  = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

  const endpoints = [
    `/accounts/${accountCode}/returnmessages?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=50`,
    `/accounts/${accountCode}/messages?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=50`,
    `/returnmessages?account=${accountCode}&startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=50`,
    `/accounts/${accountCode}/vehicles?_limit=100&_page=1`,
    `/accounts/${accountCode}/vehicles?_limit=100&_page=2`,
    `/accounts/${accountCode}/vehicles?_limit=100&_offset=0`,
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