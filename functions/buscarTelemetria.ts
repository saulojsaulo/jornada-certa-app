import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const BASE_URL = 'https://aapi3.autotrac-online.com.br/aticapi/v1';

function autotracHeaders(usuario, senha, apiKey) {
  return {
    'Authorization': `Basic ${usuario}:${senha}`,
    'Ocp-Apim-Subscription-Key': apiKey,
    'Content-Type': 'application/json',
  };
}

function calcularDistancia(pontos) {
  if (!pontos || pontos.length < 2) return 0;
  
  const toRad = (deg) => (deg * Math.PI) / 180;
  let distanciaTotal = 0;
  
  for (let i = 1; i < pontos.length; i++) {
    const p1 = pontos[i - 1];
    const p2 = pontos[i];
    
    if (!p1.lat || !p1.lng || !p2.lat || !p2.lng) continue;
    
    const R = 6371;
    const dLat = toRad(p2.lat - p1.lat);
    const dLng = toRad(p2.lng - p1.lng);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    distanciaTotal += R * c;
  }
  
  return Math.round(distanciaTotal * 100) / 100;
}

function amostrarPontos(pontos, maxPontos = 100) {
  if (!pontos || pontos.length <= maxPontos) return pontos;
  
  const intervalo = Math.floor(pontos.length / maxPontos);
  const amostrados = [];
  let ultimaIgnicao = null;
  
  for (let i = 0; i < pontos.length; i++) {
    const incluir = i === 0 || i === pontos.length - 1 || i % intervalo === 0;
    const mudouIgnicao = ultimaIgnicao !== null && pontos[i].ignition !== ultimaIgnicao;
    
    if (incluir || mudouIgnicao) {
      amostrados.push(pontos[i]);
      ultimaIgnicao = pontos[i].ignition;
    }
  }
  
  return amostrados;
}

async function buscarTelemetriaVeiculo(supabase, empresa, vehicleCode, date) {
  const cfg = empresa.api_config || {};
  const usuario = cfg.autotrac_usuario || Deno.env.get('AUTOTRAC_USER');
  const senha = cfg.autotrac_senha || Deno.env.get('AUTOTRAC_PASS');
  const apiKey = cfg.autotrac_api_key || Deno.env.get('AUTOTRAC_API_KEY');
  const accountNum = String(cfg.autotrac_account || Deno.env.get('AUTOTRAC_ACCOUNT') || '');

  if (!usuario || !senha || !apiKey) {
    throw new Error('Credenciais Autotrac não configuradas');
  }

  const headers = autotracHeaders(usuario, senha, apiKey);
  const accountsRes = await fetch(`${BASE_URL}/accounts?_limit=500`, { headers });
  const accountsRaw = await accountsRes.json();
  const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
  const conta = accountNum ? accountList.find(a => String(a.Number) === accountNum) : accountList[0];

  if (!conta) {
    throw new Error('Conta Autotrac não encontrada');
  }

  const startDate = new Date(`${date}T00:00:00-03:00`);
  const endDate = new Date(`${date}T23:59:59-03:00`);
  const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  const url = `${BASE_URL}/accounts/${conta.Code}/vehicles/${vehicleCode}/positions?startDate=${encodeURIComponent(fmt(startDate))}&endDate=${encodeURIComponent(fmt(endDate))}&_limit=2000`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const res = await fetch(url, { headers, signal: controller.signal });
  clearTimeout(timeout);

  if (!res.ok) {
    if (res.status === 422) {
      return { pontos: [], distancia_km: 0, total_raw: 0, skipped: true };
    }
    throw new Error(`Erro API: ${res.status}`);
  }

  const data = await res.json();
  const items = Array.isArray(data) ? data : (data.Data || data.data || []);

  if (!items.length) {
    return { pontos: [], distancia_km: 0, total_raw: 0, saved: true };
  }

  const pontosBrutos = items.map(p => ({
    time: p.PositionTime || p.ReceivedTime,
    speed: p.Speed || 0,
    ignition: p.Ignition === 'ON' || p.Ignition === true,
    lat: p.Latitude,
    lng: p.Longitude,
  })).sort((a, b) => new Date(a.time) - new Date(b.time));

  const distancia = calcularDistancia(pontosBrutos);
  const pontosAmostrados = amostrarPontos(pontosBrutos, 100);
  const telemetriaData = {
    vehicle_code: vehicleCode,
    data_jornada: date,
    company_id: empresa.id,
    pontos: pontosAmostrados,
    distancia_km: distancia,
    total_raw: pontosBrutos.length,
  };

  const { data: existente } = await supabase
    .from('telemetria_veiculos')
    .select('id')
    .eq('vehicle_code', vehicleCode)
    .eq('data_jornada', date)
    .eq('company_id', empresa.id)
    .maybeSingle();

  if (existente) {
    const { error } = await supabase.from('TelemetriaVeiculo').update(telemetriaData).eq('id', existente.id);
    if (error) {
      throw new Error(`Erro ao atualizar telemetria: ${error.message}`);
    }
  } else {
    const { error } = await supabase.from('TelemetriaVeiculo').insert([telemetriaData]);
    if (error) {
      throw new Error(`Erro ao inserir telemetria: ${error.message}`);
    }
  }

  return {
    pontos: pontosAmostrados,
    distancia_km: distancia,
    total_raw: pontosBrutos.length,
    saved: true,
  };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const db = base44.asServiceRole;
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  );

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { vehicleCode, company_id, date } = body;

  try {
    if (vehicleCode && company_id && date) {
      const empresas = await db.entities.Empresa.filter({ id: company_id }, '-created_date', 1);
      const empresa = empresas?.[0];

      if (!empresa) {
        return Response.json({ error: 'Empresa não encontrada' }, { status: 404 });
      }

      const result = await buscarTelemetriaVeiculo(supabase, empresa, vehicleCode, date);
      return Response.json(result);
    }

    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const empresas = await db.entities.Empresa.filter({ provedora_rastreamento: 'autotrac', ativa: true }, '-created_date', 100);

    if (!empresas?.length) {
      return Response.json({ success: true, message: 'Nenhuma empresa ativa encontrada', results: [] });
    }

    const results = [];

    for (const empresa of empresas) {
      const veiculos = await db.entities.Veiculo.filter({ company_id: empresa.id, ativo: true }, '-created_date', 500);

      const codigos = (veiculos || []).map(v => v.numero_frota).filter(Boolean);
      let processados = 0;
      let salvos = 0;

      for (let i = 0; i < codigos.length; i += 5) {
        const lote = codigos.slice(i, i + 5);
        const loteResultados = await Promise.all(lote.map(async (codigo) => {
          try {
            const result = await buscarTelemetriaVeiculo(supabase, empresa, codigo, hoje);
            return result.saved ? 1 : 0;
          } catch (error) {
            console.error(`Erro telemetria ${empresa.nome} ${codigo}:`, error.message);
            return 0;
          }
        }));
        processados += lote.length;
        salvos += loteResultados.reduce((a, b) => a + b, 0);
        await new Promise(r => setTimeout(r, 400));
      }

      results.push({ empresa: empresa.nome, veiculos_processados: processados, telemetrias_salvas: salvos, data: hoje });
    }

    return Response.json({ success: true, scheduled: true, date: hoje, results });
  } catch (e) {
    console.error('Erro buscarTelemetria:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
});