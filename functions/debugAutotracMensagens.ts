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
  let res;
  try {
    res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error(`Timeout: ${url}`);
    throw e;
  }
  const txt = await res.text();
  return { status: res.status, ok: res.ok, body: txt.substring(0, 3000) };
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

  // 1. Buscar contas para pegar o Code
  const accountsRes = await autotracGet(`${BASE_URL}/accounts?_limit=500`, headers);
  let accountCode = null;
  try {
    const parsed = JSON.parse(accountsRes.body);
    const list = Array.isArray(parsed) ? parsed : (parsed.Data || []);
    const conta = list.find(a => String(a.Number) === String(accountNum)) || list[0];
    accountCode = conta?.Code;
  } catch {}

  const now  = new Date();
  const from = new Date(now - 24 * 60 * 60 * 1000);
  const fmt  = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

  // 2. Testar endpoint bulk (conta inteira)
  const bulkRes = await autotracGet(
    `${BASE_URL}/accounts/${accountCode}/returnmessages?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=10`,
    headers
  );

  // 3. Testar endpoint por veículo (pegar primeiros 5 veículos e buscar 72h)
  const db = base44.asServiceRole;
  const veiculos = await db.entities.Veiculo.list('-created_date', 5);
  
  const v = veiculos.find(v => v.numero_frota);

  // Testar múltiplas janelas para descobrir qual o formato correto de data da API
  const fmtLocal = (d) => {
    // Horário de Brasília (UTC-3)
    const local = new Date(d.getTime() - 3 * 60 * 60 * 1000);
    return local.toISOString().slice(0, 19).replace('T', ' ');
  };

  const from24hUTC = new Date(now - 24 * 60 * 60 * 1000);
  const from24hLocal = new Date(now - 24 * 60 * 60 * 1000);

  const [r1, r2] = await Promise.all([
    // Teste 1: datas em UTC
    autotracGet(
      `${BASE_URL}/accounts/${accountCode}/vehicles/${v.numero_frota}/returnmessages?startDate=${encodeURIComponent(fmt(from24hUTC))}&endDate=${encodeURIComponent(fmt(now))}&_limit=10`,
      headers
    ),
    // Teste 2: datas em horário local (Brasília, UTC-3)
    autotracGet(
      `${BASE_URL}/accounts/${accountCode}/vehicles/${v.numero_frota}/returnmessages?startDate=${encodeURIComponent(fmtLocal(from24hLocal))}&endDate=${encodeURIComponent(fmtLocal(now))}&_limit=10`,
      headers
    ),
  ]);

  return Response.json({
    accountCode,
    veiculo: { numero_frota: v.numero_frota, nome: v.nome_veiculo },
    teste_utc: { periodo: `${fmt(from24hUTC)} -> ${fmt(now)}`, result: r1 },
    teste_brasilia: { periodo: `${fmtLocal(from24hLocal)} -> ${fmtLocal(now)}`, result: r2 },
  });
});