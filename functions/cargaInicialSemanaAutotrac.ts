import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const BASE_URL = 'https://aapi3.autotrac-online.com.br/aticapi/v1';
const TIMEZONE = 'America/Sao_Paulo';
const MACROS_VALIDAS = new Set([1, 2, 3, 4, 5, 6, 9, 10]);

function autotracHeaders(usuario, senha, apiKey) {
  return {
    Authorization: `Basic ${usuario}:${senha}`,
    'Ocp-Apim-Subscription-Key': apiKey,
    'Content-Type': 'application/json',
  };
}

function localDateString(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(date);
}

function dayBounds(dateStr) {
  const start = new Date(`${dateStr}T00:00:00-03:00`);
  const end = new Date(`${dateStr}T23:59:59-03:00`);
  return { start, end };
}

function fmtApiDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizarMacro(numero) {
  const mapa = {
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5,
    '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'Macro 1': 1, 'Macro 2': 2, 'Macro 3': 3, 'Macro 4': 4,
    'Macro 5': 5, 'Macro 6': 6, 'Macro 7': 7, 'Macro 8': 8,
    'Macro 9': 9, 'Macro 10': 10,
  };
  return mapa[String(numero)] || null;
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
  const intervalo = Math.max(1, Math.floor(pontos.length / maxPontos));
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

async function fetchJsonWithRetry(url, headers, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeout);

      if (res.status === 429) {
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw new Error('Rate limit exceeded');
      }

      if (res.status === 422 || res.status === 404) {
        return { status: res.status, data: [] };
      }

      if (!res.ok) {
        throw new Error(`Erro API: ${res.status}`);
      }

      return { status: res.status, data: await res.json() };
    } catch (error) {
      clearTimeout(timeout);
      if (attempt >= maxRetries) throw error;
      if (error.name === 'AbortError' || String(error.message).includes('Rate limit')) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

async function getAutotracContext(empresa) {
  const cfg = empresa.api_config || {};
  const usuario = cfg.autotrac_usuario || Deno.env.get('AUTOTRAC_USER');
  const senha = cfg.autotrac_senha || Deno.env.get('AUTOTRAC_PASS');
  const apiKey = cfg.autotrac_api_key || Deno.env.get('AUTOTRAC_API_KEY');
  const accountNum = String(cfg.autotrac_account || Deno.env.get('AUTOTRAC_ACCOUNT') || '');

  if (!usuario || !senha || !apiKey) {
    throw new Error('Credenciais Autotrac não configuradas');
  }

  const headers = autotracHeaders(usuario, senha, apiKey);
  const accountsResponse = await fetchJsonWithRetry(`${BASE_URL}/accounts?_limit=500`, headers);
  const accountList = Array.isArray(accountsResponse.data) ? accountsResponse.data : (accountsResponse.data?.Data || []);
  const conta = accountNum ? accountList.find(a => String(a.Number) === accountNum) : accountList[0];

  if (!conta) {
    throw new Error('Conta Autotrac não encontrada');
  }

  return { headers, accountCode: conta.Code };
}

async function carregarMacrosVeiculo(veiculo, empresa, headers, accountCode, dateStr, macrosExistentesSet) {
  const { start, end } = dayBounds(dateStr);
  let offset = 0;
  const limit = 200;
  let hasMore = true;
  const macros = [];

  while (hasMore) {
    const url = `${BASE_URL}/accounts/${accountCode}/vehicles/${veiculo.numero_frota}/returnmessages?startDate=${encodeURIComponent(fmtApiDate(start))}&endDate=${encodeURIComponent(fmtApiDate(end))}&_limit=${limit}&_offset=${offset}`;
    const response = await fetchJsonWithRetry(url, headers);
    const items = Array.isArray(response.data) ? response.data : (response.data?.Data || response.data?.data || response.data?.items || []);

    if (!items.length) {
      hasMore = false;
      break;
    }

    for (const macro of items) {
      const numeroMacro = normalizarMacro(macro.Macro || macro.MacroNumber || macro.macro || macro.macroNumber);
      if (!numeroMacro || !MACROS_VALIDAS.has(numeroMacro)) continue;

      const dataOriginal = macro.MessageTime || macro.PositionTime || macro.DateTime || macro.Date || macro.dateTime || macro.date || macro.MacroTime || macro.ReceivedTime;
      const dataEvento = new Date(dataOriginal);
      if (Number.isNaN(dataEvento.getTime())) continue;

      const dataJornada = localDateString(dataEvento);
      const chave = `${veiculo.id}-${numeroMacro}-${dataEvento.toISOString()}`;
      if (macrosExistentesSet.has(chave)) continue;

      macros.push({
        veiculo_id: veiculo.id,
        numero_macro: numeroMacro,
        data_criacao: dataEvento.toISOString(),
        jornada_id: `${veiculo.id}-${dataJornada}`,
        data_jornada: dataJornada,
        latitude: macro.Latitude ?? macro.latitude ?? macro.Lat ?? macro.lat ?? null,
        longitude: macro.Longitude ?? macro.longitude ?? macro.Long ?? macro.lon ?? macro.Lng ?? macro.lng ?? null,
        endereco: macro.Address ?? macro.address ?? macro.City ?? macro.city ?? macro.Landmark ?? null,
        company_id: empresa.id,
        excluido: false,
        editado_manualmente: false,
      });
      macrosExistentesSet.add(chave);
    }

    offset += limit;
    if (items.length < limit) hasMore = false;
    await new Promise(r => setTimeout(r, 150));
  }

  return macros;
}

async function carregarPosicoesETelemetria(db, supabase, veiculo, empresa, headers, accountCode, dateStr, posicoesExistentesSet) {
  const { start, end } = dayBounds(dateStr);
  const url = `${BASE_URL}/accounts/${accountCode}/vehicles/${veiculo.numero_frota}/positions?startDate=${encodeURIComponent(fmtApiDate(start))}&endDate=${encodeURIComponent(fmtApiDate(end))}&_limit=5000`;
  const response = await fetchJsonWithRetry(url, headers);
  const items = Array.isArray(response.data) ? response.data : (response.data?.Data || response.data?.data || []);

  if (!items.length) {
    return { telemetriaSalva: false, posicaoSalva: false };
  }

  const pontosBrutos = items.map(p => ({
    time: p.PositionTime || p.ReceivedTime,
    speed: p.Speed || 0,
    ignition: p.Ignition === 'ON' || p.Ignition === true || p.Ignition === 1,
    lat: p.Latitude,
    lng: p.Longitude,
  })).sort((a, b) => new Date(a.time) - new Date(b.time));

  const pontosAmostrados = amostrarPontos(pontosBrutos, 100);
  const distancia = calcularDistancia(pontosBrutos);

  const { data: telemetriaExistente } = await supabase
    .from('telemetria_veiculos')
    .select('id')
    .eq('company_id', empresa.id)
    .eq('vehicle_code', veiculo.numero_frota)
    .eq('data_jornada', dateStr)
    .maybeSingle();

  const telemetriaPayload = {
    vehicle_code: veiculo.numero_frota,
    veiculo_id: veiculo.id,
    data_jornada: dateStr,
    company_id: empresa.id,
    pontos: pontosAmostrados,
    distancia_km: distancia,
    total_raw: pontosBrutos.length,
    updated_at: new Date().toISOString(),
  };

  if (telemetriaExistente?.id) {
    const { error } = await supabase.from('telemetria_veiculos').update(telemetriaPayload).eq('id', telemetriaExistente.id);
    if (error) throw new Error(`Erro telemetria ${veiculo.numero_frota}: ${error.message}`);
  } else {
    const { error } = await supabase.from('telemetria_veiculos').insert([{
      ...telemetriaPayload,
      created_at: new Date().toISOString(),
      created_by: 'carga_inicial_semana',
    }]);
    if (error) throw new Error(`Erro telemetria ${veiculo.numero_frota}: ${error.message}`);
  }

  const ultima = [...items].sort((a, b) => new Date(b.PositionTime || b.ReceivedTime) - new Date(a.PositionTime || a.ReceivedTime))[0];
  const posicaoKey = `${veiculo.numero_frota}-${dateStr}`;
  if (!posicoesExistentesSet.has(posicaoKey)) {
    const { error } = await supabase.from('posicoes_veiculos').insert([{
      vehicle_code: veiculo.numero_frota,
      veiculo_id: veiculo.id,
      data_posicao: ultima.PositionTime || ultima.ReceivedTime || end.toISOString(),
      latitude: ultima.Latitude,
      longitude: ultima.Longitude,
      endereco: ultima.Landmark || null,
      company_id: empresa.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: 'carga_inicial_semana',
    }]);
    if (error) throw new Error(`Erro posição ${veiculo.numero_frota}: ${error.message}`);
    posicoesExistentesSet.add(posicaoKey);
  }

  return { telemetriaSalva: true, posicaoSalva: true };
}

function buildLastCompleteDays(days) {
  const dias = [];
  const now = new Date();
  const ontem = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  for (let i = days - 1; i >= 0; i--) {
    dias.push(localDateString(new Date(ontem.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  return dias;
}

Deno.serve(async (req) => {
  try {
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

    const days = Math.max(1, Math.min(6, Number(body.days || 6)));
    const companyId = body.company_id || null;
    const dias = body.date_inicio && body.date_fim
      ? (() => {
          const result = [];
          const start = new Date(`${body.date_inicio}T12:00:00-03:00`);
          const end = new Date(`${body.date_fim}T12:00:00-03:00`);
          for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)) {
            result.push(localDateString(cursor));
          }
          return result;
        })()
      : buildLastCompleteDays(days);

    const empresas = companyId
      ? await db.entities.Empresa.filter({ id: companyId }, '-created_date', 1)
      : await db.entities.Empresa.filter({ provedora_rastreamento: 'autotrac', ativa: true }, '-created_date', 100);

    if (!empresas?.length) {
      return Response.json({ success: false, error: 'Nenhuma empresa Autotrac encontrada' }, { status: 404 });
    }

    const results = [];

    for (const empresa of empresas) {
      const empresaResumo = {
        empresa: empresa.nome,
        periodo: `${dias[0]} a ${dias[dias.length - 1]}`,
        dias_processados: dias.length,
        macros_salvas: 0,
        telemetrias_salvas: 0,
        posicoes_salvas: 0,
        veiculos_processados: 0,
      };

      try {
        const { headers, accountCode } = await getAutotracContext(empresa);
        const veiculos = await db.entities.Veiculo.filter({ company_id: empresa.id, ativo: true }, '-created_date', 500);
        empresaResumo.veiculos_processados = veiculos.length;

        for (const dateStr of dias) {
          const { data: macrosExistentes } = await supabase
            .from('macro_eventos')
            .select('veiculo_id, numero_macro, data_criacao')
            .eq('company_id', empresa.id)
            .gte('data_criacao', `${dateStr}T00:00:00`)
            .lte('data_criacao', `${dateStr}T23:59:59`);

          const macrosExistentesSet = new Set(
            (macrosExistentes || []).map(m => `${m.veiculo_id}-${m.numero_macro}-${new Date(m.data_criacao).toISOString()}`)
          );

          const { data: posicoesExistentes } = await supabase
            .from('posicoes_veiculos')
            .select('vehicle_code, data_posicao')
            .eq('company_id', empresa.id)
            .gte('data_posicao', `${dateStr}T00:00:00-03:00`)
            .lte('data_posicao', `${dateStr}T23:59:59-03:00`);

          const posicoesExistentesSet = new Set(
            (posicoesExistentes || []).map(p => `${p.vehicle_code}-${localDateString(new Date(p.data_posicao))}`)
          );

          const novosMacros = [];

          for (let i = 0; i < veiculos.length; i += 2) {
            const lote = veiculos.slice(i, i + 2);
            const respostas = await Promise.all(lote.map(async (veiculo) => {
              try {
                const macros = await carregarMacrosVeiculo(veiculo, empresa, headers, accountCode, dateStr, macrosExistentesSet);
                const telemetria = await carregarPosicoesETelemetria(db, supabase, veiculo, empresa, headers, accountCode, dateStr, posicoesExistentesSet);
                return { macros, telemetria };
              } catch (error) {
                console.error(`Erro carga inicial ${empresa.nome} ${veiculo.numero_frota} ${dateStr}:`, error.message);
                return { macros: [], telemetria: { telemetriaSalva: false, posicaoSalva: false } };
              }
            }));

            for (const resposta of respostas) {
              novosMacros.push(...resposta.macros);
              if (resposta.telemetria.telemetriaSalva) empresaResumo.telemetrias_salvas += 1;
              if (resposta.telemetria.posicaoSalva) empresaResumo.posicoes_salvas += 1;
            }

            await new Promise(r => setTimeout(r, 400));
          }

          if (novosMacros.length > 0) {
            for (let i = 0; i < novosMacros.length; i += 100) {
              const batch = novosMacros.slice(i, i + 100);
              const { error } = await supabase.from('macro_eventos').insert(batch);
              if (error) {
                console.error(`Erro ao salvar macros ${empresa.nome} ${dateStr}:`, error.message);
              } else {
                empresaResumo.macros_salvas += batch.length;
              }
              await new Promise(r => setTimeout(r, 200));
            }
          }
        }

        results.push(empresaResumo);
      } catch (error) {
        results.push({ ...empresaResumo, error: error.message });
      }
    }

    return Response.json({
      success: true,
      mode: 'carga_inicial',
      periodo: `${dias[0]} a ${dias[dias.length - 1]}`,
      results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});