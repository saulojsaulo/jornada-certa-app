import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { createClient } from 'npm:@supabase/supabase-js';

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
  const db = base44.asServiceRole;

  // Inicialização do cliente Supabase
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(JSON.stringify({ error: 'Credenciais do Supabase não configuradas.' }), { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });
  // Fim da inicialização do Supabase

  const body = await req.json().catch(() => ({}));
  const { vehicleCode, data, company_id, macro1Time } = body;

  if (!vehicleCode || !data) {
    return Response.json({ error: 'vehicleCode e data são obrigatórios' }, { status: 400 });
  }

  // Calcular "hoje" no fuso de São Paulo (UTC-3) para evitar confusão no período 21h-23h59 SP
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

  // Para dias que não são hoje, verificar banco primeiro
  if (data !== hoje) {
    const { data: existentes, error: selectError } = await supabase
      .from('telemetria_veiculo')
      .select('pontos, distancia_km, total_raw')
      .eq('vehicle_code', vehicleCode)
      .eq('data_jornada', data)
      .order('created_date', { ascending: false }) // Verifique se a coluna 'created_date' existe na sua tabela 'telemetria_veiculo'. Se não, remova esta linha.
      .limit(1);

    if (selectError) {
      console.error(`Erro ao buscar telemetria existente no Supabase: ${selectError.message}`);
      // Decida se você quer lançar um erro ou continuar sem os dados existentes
    }

    if (existentes?.length > 0 && existentes[0].pontos?.length > 0) {
      return Response.json({
        points: existentes[0].pontos,
        distanciaKm: existentes[0].distancia_km ?? 0,
        total_raw: existentes[0].total_raw ?? 0,
        total_pontos: existentes[0].pontos.length,
        total_sampled: existentes[0].pontos.length,
        source: 'db',
      });
    }
  }

  // Buscar credenciais da empresa
  let usuario, senha, apiKey, accountNum;

  if (company_id) {
    const { data: empresas, error: empresaError } = await supabase
      .from('empresas')
      .select('*')
      .eq('id', company_id);

    if (empresaError) {
      console.error(`Erro ao buscar empresa no Supabase: ${empresaError.message}`);
      return Response.json({ error: 'Erro ao buscar dados da empresa.' }, { status: 500 });
    }
    
    const empresa = empresas?.[0];
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

  // Janela de tempo: desde Macro 1 ou desde o início do dia NO FUSO DE BRASÍLIA (UTC-3)
  // Usar offset explícito -03:00 para garantir meia-noite e 23h59 corretos em SP
  const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  let from = new Date(`${data}T00:00:00-03:00`);
  let to   = new Date(`${data}T23:59:59-03:00`);
  
  // Se macro1Time foi fornecida, usar como início
  if (macro1Time) {
    from = new Date(macro1Time);
  }

  // Endpoint /positions retorna dados GPS contínuos com Velocity e VehicleIgnition
  const url = `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/positions?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(to))}&_limit=5000`;

  const raw = await autotracGet(url, headers);
  const mensagens = Array.isArray(raw) ? raw : (raw.Data || raw.data || []);

  // Processar posições: Velocity em km/h, VehicleIgnition 1=ligada
  const pontos = mensagens
    .filter(m => m.PositionTime || m.ReceivedTime)
    .map(m => {
      const time = m.PositionTime || m.ReceivedTime;
      const speed = Math.round(Number(m.Velocity ?? 0));
      const ignition = m.VehicleIgnition === 1;

      return {
        time: new Date(time).getTime(),
        speed,
        ignition,
      };
    })
    .filter(p => !isNaN(p.time))
    .sort((a, b) => a.time - b.time);

  const sampled = samplePoints(pontos, 400);

  // Calcular distância total percorrida usando o campo Odometer
  // Odometer vem como inteiro e deve ser dividido por 100 para obter km
  // Usar: odômetro da última posição - odômetro da Macro 1
  let distanciaKm = 0;
  const fromTime = from.getTime();
  const toTime = to.getTime();
  
  const pontosComOdometro = mensagens
    .filter(m => {
      if (!m.Odometer || m.Odometer <= 0) return false;
      const msgTime = new Date(m.PositionTime || m.ReceivedTime).getTime();
      return msgTime >= fromTime && msgTime <= toTime;
    })
    .sort((a, b) => new Date(a.PositionTime || a.ReceivedTime) - new Date(b.PositionTime || b.ReceivedTime));

  if (pontosComOdometro.length >= 2) {
    const primeiroOdometro = pontosComOdometro[0].Odometer / 100; // Macro 1
    const ultimoOdometro = pontosComOdometro[pontosComOdometro.length - 1].Odometer / 100; // Última posição
    distanciaKm = Math.round((ultimoOdometro - primeiroOdometro) * 100) / 100;
  }

  // Persistir telemetria no banco (upsert: delete antigo e cria novo)
  try {
    const { data: veiculos, error: veiculoError } = await supabase
      .from('veiculos')
      .select('id')
      .eq('numero_frota', vehicleCode);

    if (veiculoError) {
      console.error(`Erro ao buscar veículo no Supabase: ${veiculoError.message}`);
      // Decida como tratar o erro, se necessário
    }
    
    const veiculoId = veiculos?.[0]?.id || null;

    // Remover telemetria existente do mesmo veículo+dia para evitar duplicatas
    const { error: deleteError } = await supabase
      .from('telemetria_veiculo')
      .delete()
      .eq('vehicle_code', vehicleCode)
      .eq('data_jornada', data);

    if (deleteError) {
      console.error(`Erro ao deletar telemetria existente no Supabase: ${deleteError.message}`);
      // Decida como tratar o erro, se necessário
    }

    const { error: insertError } = await supabase
      .from('telemetria_veiculo')
      .insert({
        vehicle_code: vehicleCode,
        veiculo_id: veiculoId,
        data_jornada: data,
        pontos: sampled,
        distancia_km: distanciaKm,
        total_raw: mensagens.length,
        company_id: company_id,
      });
    
    if (insertError) {
      console.error(`Erro ao inserir telemetria no Supabase: ${insertError.message}`);
      // Decida como tratar o erro, se necessário
    }

  } catch (e) {
    console.error("Erro na seção de persistência de telemetria:", e.message);
  }

  return Response.json({
    points: sampled,
    distanciaKm,
    total_raw: mensagens.length,
    total_pontos: pontos.length,
    total_sampled: sampled.length,
  });
});