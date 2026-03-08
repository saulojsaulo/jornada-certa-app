import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const BASE_URL = 'https://aapi3.autotrac-online.com.br/aticapi/v1';
const BASE_URL_WAPI = 'https://wapi.autotrac-online.com.br/aticapi/v1';

function autotracHeaders(usuario, senha, apiKey) {
  return {
    'Authorization': `Basic ${usuario}:${senha}`,
    'Ocp-Apim-Subscription-Key': apiKey,
    'Content-Type': 'application/json',
    'User-Agent': 'PostmanRuntime/7.37.0',
    'Cache-Control': 'no-cache',
  };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
  } catch {}

  const usuario = Deno.env.get('AUTOTRAC_USER');
  const senha   = Deno.env.get('AUTOTRAC_PASS');
  const apiKey  = Deno.env.get('AUTOTRAC_API_KEY');
  const accountNum = Deno.env.get('AUTOTRAC_ACCOUNT');

  const headers = autotracHeaders(usuario, senha, apiKey);

  // Buscar conta
  const accountsRaw = await fetch(`${BASE_URL}/accounts?_limit=500`, { headers }).then(r => r.json());
  const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
  const conta = accountList.find(a => String(a.Number) === String(accountNum)) || accountList[0];

  if (!conta) return Response.json({ error: 'Conta não encontrada', accountsRaw });

  const accountCode = conta.Code;

  // Janela das últimas 4h
  const now  = new Date();
  const from = new Date(now - 4 * 60 * 60 * 1000);
  const fmt  = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

  // Testar endpoint por veículo (mais provável conforme doc)
  // Usar um vehicleCode fixo do ambiente ou pegar o primeiro veículo disponível
  const body = await req.json().catch(() => ({}));
  const vehicleCode = body.vehicleCode || '1'; // passar via payload no teste

  const url = `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/drivervehiclelog?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=5`;

  const res = await fetch(url, { headers });
  const status = res.status;
  const resBody = await res.text();

  let parsed;
  try { parsed = JSON.parse(resBody); } catch { parsed = resBody.substring(0, 500); }

  return Response.json({ url, status, accountCode, data: parsed });
});