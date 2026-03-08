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
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`${res.status}: ${txt.substring(0, 200)}`);
    }
    return res.json();
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error(`Timeout: ${url}`);
    throw e;
  }
}

// Amostragem inteligente: mantém pontos de mudança de velocidade e picos
function samplePoints(points, maxPoints = 300) {
  if (points.length <= maxPoints) return points;

  const result = [points[0]];
  const step = Math.floor(points.length / maxPoints);

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    // Manter sempre pontos de mudança de ignição
    if (curr.ignition !== prev.ignition) {
      result.push(curr);
      continue;
    }

    // Manter picos de velocidade (local max/min)
    if ((curr.speed > prev.speed && curr.speed > next.speed) ||
        (curr.speed < prev.speed && curr.speed < next.speed)) {
      result.push(curr);
      continue;
    }

    // Manter a cada N pontos
    if (i % step === 0) {
      result.push(curr);
    }
  }

  result.push(points[points.length - 1]);
  return result;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const body = await req.json().catch(() => ({}));
  const { vehicleCode, data, company_id } = body;

  if (!vehicleCode || !data) {
    return Response.json({ error: 'vehicleCode e data são obrigatórios' }, { status: 400 });
  }

  const db = base44.asServiceRole;

  // Buscar credenciais da empresa
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
  const accountsRaw = await autotracGet(`${BASE_URL}/accounts?_limit=500`, headers);
  const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
  const conta = accountNum
    ? accountList.find(a => String(a.Number) === accountNum)
    : accountList[0];

  if (!conta) {
    return Response.json({ error: 'Conta Autotrac não encontrada' }, { status: 404 });
  }

  const accountCode = conta.Code;

  // Janela de tempo: dia inteiro (00:00 até 23:59)
  const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  const from = new Date(`${data}T00:00:00.000Z`);
  const to = new Date(`${data}T23:59:59.000Z`);

  // Buscar todas as mensagens do dia (incluindo posições GPS, não só macros)
  // MsgSubType 1001 = macro, outros = posições GPS com velocidade
  const url = `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/returnmessages?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(to))}&_limit=5000`;

  const raw = await autotracGet(url, headers);
  const mensagens = Array.isArray(raw) ? raw : (raw.Data || raw.data || []);

  // Extrair velocidade do campo Landmark (ex: "3.26 Km ESE de CIDADE, 0.00 Km/h")
  function extractSpeedFromLandmark(landmark) {
    if (!landmark) return null;
    const match = landmark.match(/([\d.]+)\s*Km\/h/i);
    return match ? parseFloat(match[1]) : null;
  }

  // Ignição: campo Ignition == 1 = ligada, 2 = desligada (baseado nos dados reais)
  function parseIgnition(val) {
    if (val === 1) return true;
    if (val === 2) return false;
    return Boolean(val);
  }

  // Processar mensagens: extrair posição/velocidade/ignição
  const pontos = mensagens
    .filter(m => {
      const time = m.MessageTime || m.PositionTime || m.DateTime || m.Date;
      return time && (m.Latitude || m.latitude) && (m.Longitude || m.longitude);
    })
    .map(m => {
      const time = m.MessageTime || m.PositionTime || m.DateTime || m.Date;
      const speedFromLandmark = extractSpeedFromLandmark(m.Landmark || m.landmark);
      const speed = speedFromLandmark ?? 0;
      const ignitionField = m.Ignition ?? m.ignition ?? m.IgnitionOn;
      const ignition = ignitionField !== undefined ? parseIgnition(ignitionField) : speed > 0;

      return {
        time: new Date(time).getTime(),
        speed: Math.round(speed),
        ignition,
      };
    })
    .filter(p => !isNaN(p.time))
    .sort((a, b) => a.time - b.time);

  const sampled = samplePoints(pontos, 400);

  return Response.json({
    points: sampled,
    total_raw: mensagens.length,
    total_pontos: pontos.length,
    total_sampled: sampled.length,
  });
});