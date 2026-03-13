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

function fmtApiDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function dayBounds(dateStr) {
  return {
    start: new Date(`${dateStr}T00:00:00-03:00`),
    end: new Date(`${dateStr}T23:59:59-03:00`),
  };
}

function nextDate(dateStr) {
  return localDateString(new Date(new Date(`${dateStr}T12:00:00-03:00`).getTime() + 24 * 60 * 60 * 1000));
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
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
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
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
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
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
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
  if (!usuario || !senha || !apiKey) throw new Error('Credenciais Autotrac não configuradas');
  const headers = autotracHeaders(usuario, senha, apiKey);
  const accountsResponse = await fetchJsonWithRetry(`${BASE_URL}/accounts?_limit=500`, headers);
  const accountList = Array.isArray(accountsResponse.data) ? accountsResponse.data : (accountsResponse.data?.Data || []);
  const conta = accountNum ? accountList.find(a => String(a.Number) === accountNum) : accountList[0];
  if (!conta) throw new Error('Conta Autotrac não encontrada');
  return { headers, accountCode: conta.Code };
}

async function processarLoteDia(db, supabase, empresa, veiculos, dateStr, headers, accountCode) {
  const veiculoIds = veiculos.map(v => v.id);
  const vehicleCodes = veiculos.map(v => v.numero_frota).filter(Boolean);
  const { start, end } = dayBounds(dateStr);

  const { data: macrosExistentes } = await supabase
    .from('macro_eventos')
    .select('veiculo_id, numero_macro, data_criacao')
    .eq('company_id', empresa.id)
    .in('veiculo_id', veiculoIds)
    .gte('data_criacao', `${dateStr}T00:00:00`)
    .lte('data_criacao', `${dateStr}T23:59:59`);

  const macrosExistentesSet = new Set((macrosExistentes || []).map(m => `${m.veiculo_id}-${m.numero_macro}-${new Date(m.data_criacao).toISOString()}`));

  const { data: telemetriasExistentes } = await supabase
    .from('telemetria_veiculos')
    .select('id, vehicle_code')
    .eq('company_id', empresa.id)
    .eq('data_jornada', dateStr)
    .in('vehicle_code', vehicleCodes);

  const telemetriaMap = new Map((telemetriasExistentes || []).map(t => [t.vehicle_code, t.id]));

  const { data: posicoesExistentes } = await supabase
    .from('posicoes_veiculos')
    .select('vehicle_code, data_posicao')
    .eq('company_id', empresa.id)
    .in('vehicle_code', vehicleCodes)
    .gte('data_posicao', start.toISOString())
    .lte('data_posicao', end.toISOString());

  const posicoesSet = new Set((posicoesExistentes || []).map(p => `${p.vehicle_code}-${localDateString(new Date(p.data_posicao))}`));

  const macrosParaInserir = [];
  let telemetriasSalvas = 0;
  let posicoesSalvas = 0;

  for (const veiculo of veiculos) {
    if (!veiculo.numero_frota) continue;

    try {
      let offset = 0;
      const macroLimit = 200;
      let hasMore = true;
      while (hasMore) {
        const macroUrl = `${BASE_URL}/accounts/${accountCode}/vehicles/${veiculo.numero_frota}/returnmessages?startDate=${encodeURIComponent(fmtApiDate(start))}&endDate=${encodeURIComponent(fmtApiDate(end))}&_limit=${macroLimit}&_offset=${offset}`;
        const macroResponse = await fetchJsonWithRetry(macroUrl, headers);
        const macroItems = Array.isArray(macroResponse.data) ? macroResponse.data : (macroResponse.data?.Data || macroResponse.data?.data || macroResponse.data?.items || []);
        if (!macroItems.length) {
          hasMore = false;
          break;
        }

        for (const macro of macroItems) {
          const numeroMacro = normalizarMacro(macro.Macro || macro.MacroNumber || macro.macro || macro.macroNumber);
          if (!numeroMacro || !MACROS_VALIDAS.has(numeroMacro)) continue;

          const dataOriginal = macro.MessageTime || macro.PositionTime || macro.DateTime || macro.Date || macro.dateTime || macro.date || macro.MacroTime || macro.ReceivedTime;
          const dataEvento = new Date(dataOriginal);
          if (Number.isNaN(dataEvento.getTime())) continue;

          const dataJornada = localDateString(dataEvento);
          const chave = `${veiculo.id}-${numeroMacro}-${dataEvento.toISOString()}`;
          if (macrosExistentesSet.has(chave)) continue;

          macrosParaInserir.push({
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

        offset += macroLimit;
        if (macroItems.length < macroLimit) hasMore = false;
        await new Promise(r => setTimeout(r, 100));
      }

      const posUrl = `${BASE_URL}/accounts/${accountCode}/vehicles/${veiculo.numero_frota}/positions?startDate=${encodeURIComponent(fmtApiDate(start))}&endDate=${encodeURIComponent(fmtApiDate(end))}&_limit=5000`;
      const posResponse = await fetchJsonWithRetry(posUrl, headers);
      const posItems = Array.isArray(posResponse.data) ? posResponse.data : (posResponse.data?.Data || posResponse.data?.data || []);
      if (!posItems.length) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      const pontosBrutos = posItems.map(p => ({
        time: p.PositionTime || p.ReceivedTime,
        speed: p.Speed || 0,
        ignition: p.Ignition === 'ON' || p.Ignition === true || p.Ignition === 1,
        lat: p.Latitude,
        lng: p.Longitude,
      })).sort((a, b) => new Date(a.time) - new Date(b.time));

      const telemetriaPayload = {
        vehicle_code: veiculo.numero_frota,
        veiculo_id: veiculo.id,
        data_jornada: dateStr,
        company_id: empresa.id,
        pontos: amostrarPontos(pontosBrutos, 100),
        distancia_km: calcularDistancia(pontosBrutos),
        total_raw: pontosBrutos.length,
        updated_at: new Date().toISOString(),
      };

      const telemetriaId = telemetriaMap.get(veiculo.numero_frota);
      if (telemetriaId) {
        const { error } = await supabase.from('telemetria_veiculos').update(telemetriaPayload).eq('id', telemetriaId);
        if (!error) telemetriasSalvas += 1;
      } else {
        const { error } = await supabase.from('telemetria_veiculos').insert([{
          ...telemetriaPayload,
          created_at: new Date().toISOString(),
          created_by: 'carga_inicial_semana',
        }]);
        if (!error) telemetriasSalvas += 1;
      }

      const posKey = `${veiculo.numero_frota}-${dateStr}`;
      if (!posicoesSet.has(posKey)) {
        const ultima = [...posItems].sort((a, b) => new Date(b.PositionTime || b.ReceivedTime) - new Date(a.PositionTime || a.ReceivedTime))[0];
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
        if (!error) {
          posicoesSet.add(posKey);
          posicoesSalvas += 1;
        }
      }

      await new Promise(r => setTimeout(r, 100));
    } catch (error) {
      console.error(`Erro no lote ${empresa.nome} ${veiculo.numero_frota} ${dateStr}:`, error.message);
    }
  }

  let macrosSalvas = 0;
  if (macrosParaInserir.length > 0) {
    for (let i = 0; i < macrosParaInserir.length; i += 100) {
      const batch = macrosParaInserir.slice(i, i + 100);
      const { error } = await supabase.from('macro_eventos').insert(batch);
      if (!error) macrosSalvas += batch.length;
      await new Promise(r => setTimeout(r, 150));
    }
  }

  return { macrosSalvas, telemetriasSalvas, posicoesSalvas };
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

    let jobs = await db.entities.CargaInicialJob.filter({ status: 'running' }, '-created_date', 1);
    let job = jobs?.[0];

    if (!job) {
      jobs = await db.entities.CargaInicialJob.filter({ status: 'pending' }, '-created_date', 1);
      job = jobs?.[0];
    }

    if (!job && body.company_id) {
      const dias = Math.max(1, Math.min(6, Number(body.days || 6)));
      const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const endDate = localDateString(ontem);
      const startDate = localDateString(new Date(ontem.getTime() - (dias - 1) * 24 * 60 * 60 * 1000));

      job = await db.entities.CargaInicialJob.create({
        company_id: body.company_id,
        start_date: startDate,
        end_date: endDate,
        current_date: startDate,
        vehicle_offset: 0,
        vehicle_chunk_size: body.vehicle_chunk_size || 50,
        status: 'pending',
        last_message: `Job criado para ${startDate} até ${endDate}`,
        runs_count: 0,
      });
    }

    if (!job) {
      return Response.json({ success: true, message: 'Nenhum job pendente' });
    }

    await db.entities.CargaInicialJob.update(job.id, {
      status: 'running',
      runs_count: (job.runs_count || 0) + 1,
      last_message: 'Iniciando processamento do lote',
    });

    const empresas = await db.entities.Empresa.filter({ id: job.company_id }, '-created_date', 1);
    const empresa = empresas?.[0];
    if (!empresa) {
      await db.entities.CargaInicialJob.update(job.id, { status: 'failed', last_message: 'Empresa não encontrada' });
      return Response.json({ error: 'Empresa não encontrada' }, { status: 404 });
    }

    const { headers, accountCode } = await getAutotracContext(empresa);
    const veiculos = await db.entities.Veiculo.filter({ company_id: empresa.id, ativo: true }, '-created_date', 500);
    const veiculosOrdenados = [...veiculos].sort((a, b) => String(a.numero_frota || '').localeCompare(String(b.numero_frota || '')));

    const chunkSize = job.vehicle_chunk_size || 50;
    const offset = job.vehicle_offset || 0;
    const currentDate = job.current_date || job.start_date;
    const lote = veiculosOrdenados.slice(offset, offset + chunkSize);

    if (!lote.length) {
      const proximaData = nextDate(currentDate);
      if (new Date(`${proximaData}T12:00:00-03:00`) > new Date(`${job.end_date}T12:00:00-03:00`)) {
        await db.entities.CargaInicialJob.update(job.id, {
          status: 'completed',
          last_message: 'Carga inicial concluída com sucesso',
        });
        return Response.json({ success: true, completed: true, message: 'Carga inicial concluída' });
      }

      await db.entities.CargaInicialJob.update(job.id, {
        current_date: proximaData,
        vehicle_offset: 0,
        last_message: `Avançando para ${proximaData}`,
      });
      return Response.json({ success: true, advanced_to: proximaData });
    }

    const resumo = await processarLoteDia(db, supabase, empresa, lote, currentDate, headers, accountCode);
    const novoOffset = offset + lote.length;
    let nextPayload = {
      vehicle_offset: novoOffset,
      last_message: `${currentDate} · veículos ${offset + 1}-${novoOffset} processados`,
      status: 'running',
    };

    if (novoOffset >= veiculosOrdenados.length) {
      const proximaData = nextDate(currentDate);
      if (new Date(`${proximaData}T12:00:00-03:00`) > new Date(`${job.end_date}T12:00:00-03:00`)) {
        nextPayload = {
          ...nextPayload,
          status: 'completed',
          vehicle_offset: 0,
          last_message: 'Carga inicial concluída com sucesso',
        };
      } else {
        nextPayload = {
          ...nextPayload,
          current_date: proximaData,
          vehicle_offset: 0,
          last_message: `${currentDate} finalizado · próximo dia ${proximaData}`,
        };
      }
    }

    await db.entities.CargaInicialJob.update(job.id, nextPayload);

    return Response.json({
      success: true,
      job_id: job.id,
      empresa: empresa.nome,
      data_processada: currentDate,
      veiculos_no_lote: lote.length,
      proximo_offset: nextPayload.vehicle_offset,
      status: nextPayload.status,
      resumo,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});