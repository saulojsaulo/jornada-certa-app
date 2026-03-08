import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const BASE_URL = 'https://aapi3.autotrac-online.com.br/aticapi/v1';

function autotracHeaders(usuario, senha, apiKey) {
  return {
    'Authorization': `Basic ${usuario}:${senha}`,
    'Ocp-Apim-Subscription-Key': apiKey,
    'Content-Type': 'application/json',
    'User-Agent': 'PostmanRuntime/7.37.0',
    'Cache-Control': 'no-cache',
  };
}

async function autotracGet(url, headers) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);
    const txt = await res.text();
    return { status: res.status, url, body: txt.substring(0, 1000) };
  } catch (e) {
    clearTimeout(timeout);
    return { status: 0, url, error: e.message };
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const usuario = Deno.env.get('AUTOTRAC_USER');
  const senha   = Deno.env.get('AUTOTRAC_PASS');
  const apiKey  = Deno.env.get('AUTOTRAC_API_KEY');
  const accountNum = Deno.env.get('AUTOTRAC_ACCOUNT');
  const headers = autotracHeaders(usuario, senha, apiKey);

  // Buscar accountCode
  const accountsRaw = await autotracGet(`${BASE_URL}/accounts?_limit=500`, headers);
  let accountCode = null;
  try {
    const parsed = JSON.parse(accountsRaw.body);
    const list = Array.isArray(parsed) ? parsed : (parsed.Data || []);
    const conta = list.find(a => String(a.Number) === String(accountNum)) || list[0];
    accountCode = conta?.Code;
  } catch {}

  const vehicleCode = '731123'; // veículo de teste
  const now  = new Date();
  const from = new Date(now - 24 * 60 * 60 * 1000);
  const fmt  = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

  // Testar múltiplos endpoints candidatos para posições GPS
  const endpoints = [
    `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/positions?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=10`,
    `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/lastpositions?_limit=10`,
    `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/gpspositions?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=10`,
    `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/telemetry?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=10`,
    `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/tracklog?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=10`,
    `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/returnmessages?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=10&MsgSubType=0`,
    `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/returnmessages?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=10&msgSubType=0`,
    `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/returnmessages?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=10&type=position`,
  ];

  const results = await Promise.all(endpoints.map(url => autotracGet(url, headers)));

  return Response.json({ accountCode, vehicleCode, results });
});