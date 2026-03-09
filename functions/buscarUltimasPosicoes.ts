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
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const { vehicleCodes, company_id } = body;

  if (!vehicleCodes || !vehicleCodes.length) {
    return Response.json({ error: 'vehicleCodes é obrigatório' }, { status: 400 });
  }

  const db = base44.asServiceRole;

  let usuario, senha, apiKey, accountNum;
  if (company_id) {
    const empresas = await db.entities.Empresa.filter({ id: company_id });
    const empresa = empresas[0];
    const cfg = empresa?.api_config || {};
    usuario = cfg.autotrac_usuario || Deno.env.get('AUTOTRAC_USER');
    senha = cfg.autotrac_senha || Deno.env.get('AUTOTRAC_PASS');
    apiKey = cfg.autotrac_api_key || Deno.env.get('AUTOTRAC_API_KEY');
    accountNum = String(cfg.autotrac_account || Deno.env.get('AUTOTRAC_ACCOUNT') || '');
  } else {
    usuario = Deno.env.get('AUTOTRAC_USER');
    senha = Deno.env.get('AUTOTRAC_PASS');
    apiKey = Deno.env.get('AUTOTRAC_API_KEY');
    accountNum = String(Deno.env.get('AUTOTRAC_ACCOUNT') || '');
  }

  if (!usuario || !senha || !apiKey) {
    return Response.json({ error: 'Credenciais Autotrac não configuradas' }, { status: 500 });
  }

  const headers = autotracHeaders(usuario, senha, apiKey);

  // Buscar account code
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  let accountCode;
  try {
    const accountsRes = await fetch(`${BASE_URL}/accounts?_limit=500`, { headers, signal: controller.signal });
    clearTimeout(timeout);
    const accountsRaw = await accountsRes.json();
    const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
    const conta = accountNum
      ? accountList.find(a => String(a.Number) === accountNum)
      : accountList[0];
    if (!conta) return Response.json({ error: 'Conta não encontrada' }, { status: 404 });
    accountCode = conta.Code;
  } catch (e) {
    clearTimeout(timeout);
    return Response.json({ error: e.message }, { status: 500 });
  }

  const results = {};
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

  const chunks = [];
  for (let i = 0; i < vehicleCodes.length; i += 8) {
    chunks.push(vehicleCodes.slice(i, i + 8));
  }

  for (const chunk of chunks) {
    await Promise.all(chunk.map(async (vehicleCode) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 12000);
        const url = `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/positions?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=50`;
        const res = await fetch(url, { headers, signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) { results[vehicleCode] = null; return; }
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.Data || data.data || []);
        if (!items.length) { results[vehicleCode] = null; return; }
        // Pegar o mais recente
        const sorted = items.sort((a, b) =>
          new Date(b.PositionTime || b.ReceivedTime) - new Date(a.PositionTime || a.ReceivedTime)
        );
        const last = sorted[0];
        const posicao = {
          address: last.Landmark || null,
          time: last.PositionTime || last.ReceivedTime || null,
          lat: last.Latitude,
          lng: last.Longitude,
        };
        results[vehicleCode] = posicao;

        // Persistir última posição no banco
        const veiculoId = veiculoMap[vehicleCode?.toUpperCase()?.trim()];
        const dataPosicao = posicao.time ? new Date(posicao.time).toISOString() : now.toISOString();
        try {
          await db.entities.PosicaoVeiculo.create({
            vehicle_code: vehicleCode,
            ...(veiculoId && { veiculo_id: veiculoId }),
            data_posicao: dataPosicao,
            latitude: posicao.lat ?? null,
            longitude: posicao.lng ?? null,
            endereco: posicao.address ?? null,
            ...(company_id && { company_id }),
          });
        } catch {}
      } catch {
        results[vehicleCode] = null;
      }
    }));
  }

  return Response.json({ positions: results });
});