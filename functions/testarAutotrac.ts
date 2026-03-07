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

  // Usar uma data recente com hora atual
  const now = new Date();
  const from = new Date(now - 7 * 24 * 60 * 60 * 1000); // últimos 7 dias
  const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  const sd = encodeURIComponent(fmt(from));
  const ed = encodeURIComponent(fmt(now));

  // Pegar um veículo real do banco para testar
  const db = base44.asServiceRole;
  const veiculos = await db.entities.Veiculo.list('-created_date', 10);
  const v = veiculos[0];
  const vehicleCode = v?.numero_frota || '704792';

  // Buscar todos veículos da API e comparar com banco
  const endpoints = [
    `/accounts/${accountCode}/vehicles?_limit=500`,
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

  // Comparar
  let veiculosApi = [];
  try {
    const raw = JSON.parse(Object.values(results)[0]?.sample ? JSON.stringify(Object.values(results)[0].sample) : '{}');
    veiculosApi = raw.Data || [];
  } catch {}

  const codesApi = new Set(veiculosApi.map(v => String(v.Code)));
  const codesBanco = veiculos.map(v => v.numero_frota).filter(Boolean);
  const noBancoMasNaoNaApi = codesBanco.filter(c => !codesApi.has(c));
  const naApiMasNaoNoBanco = [...codesApi].filter(c => !codesBanco.includes(c)).slice(0, 10);

  return Response.json({
    total_api: veiculosApi.length,
    total_banco: veiculos.length,
    sample_api_codes: [...codesApi].slice(0, 5),
    sample_banco_codes: codesBanco.slice(0, 5),
    no_banco_mas_nao_na_api: noBancoMasNaoNaApi.slice(0, 10),
    na_api_mas_nao_no_banco: naApiMasNaoNoBanco,
    results
  });
});