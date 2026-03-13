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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole;

    const empresas = await db.entities.Empresa.filter({ provedora_rastreamento: 'autotrac', ativa: true }, '-created_date', 1);
    const empresa = empresas?.[0];
    if (!empresa) return Response.json({ error: 'Empresa não encontrada' }, { status: 404 });

    const cfg = empresa.api_config || {};
    const usuario = cfg.autotrac_usuario || Deno.env.get('AUTOTRAC_USER');
    const senha = cfg.autotrac_senha || Deno.env.get('AUTOTRAC_PASS');
    const apiKey = cfg.autotrac_api_key || Deno.env.get('AUTOTRAC_API_KEY');
    const accountNum = String(cfg.autotrac_account || Deno.env.get('AUTOTRAC_ACCOUNT') || '');
    const headers = autotracHeaders(usuario, senha, apiKey);

    const accountsRes = await fetch(`${BASE_URL}/accounts?_limit=500`, { headers });
    const accountsRaw = await accountsRes.json();
    const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
    const conta = accountNum ? accountList.find(a => String(a.Number) === accountNum) : accountList[0];
    if (!conta) return Response.json({ error: 'Conta não encontrada' }, { status: 404 });

    const veiculos = await db.entities.Veiculo.filter({ company_id: empresa.id, ativo: true }, '-created_date', 20);
    const veiculo = veiculos.find(v => v.numero_frota);
    if (!veiculo) return Response.json({ error: 'Veículo não encontrado' }, { status: 404 });

    const now = new Date();
    const from = new Date(now.getTime() - 72 * 60 * 60 * 1000);
    const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
    const url = `${BASE_URL}/accounts/${conta.Code}/vehicles/${veiculo.numero_frota}/returnmessages?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=20`;

    const res = await fetch(url, { headers });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}

    return Response.json({
      vehicle: { id: veiculo.id, numero_frota: veiculo.numero_frota, nome: veiculo.nome_veiculo },
      status: res.status,
      sample: Array.isArray(parsed) ? parsed.slice(0, 3) : parsed,
      raw: text.slice(0, 3000)
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});