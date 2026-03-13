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

async function fetchComRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      
      if (res.status === 429) {
        const delay = Math.pow(2, i) * 2000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      return res;
    } catch (e) {
      if (i === maxRetries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error('Max retries excedido');
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

const MACROS_VALIDAS = new Set([1, 2, 3, 4, 5, 6, 9, 10]);

async function sincronizarMacrosEmpresa(db, supabase, empresa, date_inicio, date_fim) {
  const cfg = empresa.api_config || {};
  const usuario = cfg.autotrac_usuario || Deno.env.get('AUTOTRAC_USER');
  const senha = cfg.autotrac_senha || Deno.env.get('AUTOTRAC_PASS');
  const apiKey = cfg.autotrac_api_key || Deno.env.get('AUTOTRAC_API_KEY');
  const accountNum = String(cfg.autotrac_account || Deno.env.get('AUTOTRAC_ACCOUNT') || '');

  if (!usuario || !senha || !apiKey) {
    throw new Error('Credenciais Autotrac não configuradas');
  }

  const headers = autotracHeaders(usuario, senha, apiKey);
  const accountsRes = await fetchComRetry(`${BASE_URL}/accounts?_limit=500`, { headers });
  const accountsRaw = await accountsRes.json();
  const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
  const conta = accountNum ? accountList.find(a => String(a.Number) === accountNum) : accountList[0];

  if (!conta) {
    throw new Error('Conta Autotrac não encontrada');
  }

  const veiculos = await db.entities.Veiculo.filter({ company_id: empresa.id, ativo: true }, '-created_date', 500);

  if (!veiculos?.length) {
    return { veiculos_processados: 0, novos_macros: 0, periodo: `${date_inicio} a ${date_fim}` };
  }

  const { data: macrosExistentes } = await supabase
    .from('macro_eventos')
    .select('veiculo_id, numero_macro, data_criacao')
    .eq('company_id', empresa.id)
    .gte('data_criacao', `${date_inicio}T00:00:00`)
    .lte('data_criacao', `${date_fim}T23:59:59`);

  const existentesSet = new Set(
    (macrosExistentes || []).map(m => `${m.veiculo_id}-${m.numero_macro}-${new Date(m.data_criacao).toISOString()}`)
  );

  const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  const startDate = new Date(`${date_inicio}T00:00:00-03:00`);
  const endDate = new Date(`${date_fim}T23:59:59-03:00`);
  const novosMacros = [];
  let processados = 0;

  for (let i = 0; i < veiculos.length; i += 3) {
    const batch = veiculos.slice(i, i + 3);

    await Promise.all(batch.map(async (veiculo) => {
      try {
        const vehicleCode = veiculo.numero_frota;
        if (!vehicleCode) return;

        let offset = 0;
        const limit = 200;
        let hasMore = true;

        while (hasMore) {
          const url = `${BASE_URL}/accounts/${conta.Code}/vehicles/${vehicleCode}/returnmessages?startDate=${encodeURIComponent(fmt(startDate))}&endDate=${encodeURIComponent(fmt(endDate))}&_limit=${limit}&_offset=${offset}`;
          const res = await fetchComRetry(url, { headers });

          if (!res.ok) {
            if (res.status === 422) break;
            console.error(`Erro ${res.status} para veículo ${vehicleCode}`);
            break;
          }

          const data = await res.json();
          const items = Array.isArray(data) ? data : (data.Data || data.data || data.items || []);
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

            const dataJornada = dataEvento.toISOString().split('T')[0];
            const jornadaId = `${veiculo.id}-${dataJornada}`;
            const chave = `${veiculo.id}-${numeroMacro}-${dataEvento.toISOString()}`;
            if (existentesSet.has(chave)) continue;

            novosMacros.push({
              veiculo_id: veiculo.id,
              numero_macro: numeroMacro,
              data_criacao: dataEvento.toISOString(),
              jornada_id: jornadaId,
              data_jornada: dataJornada,
              latitude: macro.Latitude ?? macro.latitude ?? macro.Lat ?? macro.lat ?? null,
              longitude: macro.Longitude ?? macro.longitude ?? macro.Long ?? macro.lon ?? macro.Lng ?? macro.lng ?? null,
              endereco: macro.Address ?? macro.address ?? macro.City ?? macro.city ?? macro.Landmark ?? null,
              company_id: empresa.id,
              excluido: false,
              editado_manualmente: false,
            });
            existentesSet.add(chave);
          }

          offset += limit;
          if (items.length < limit) hasMore = false;
          await new Promise(r => setTimeout(r, 300));
        }

        processados++;
      } catch (e) {
        console.error(`Erro ao processar ${veiculo.numero_frota}: ${e.message}`);
      }
    }));

    await new Promise(r => setTimeout(r, 1000));
  }

  let salvos = 0;
  if (novosMacros.length > 0) {
    for (let i = 0; i < novosMacros.length; i += 50) {
      const batch = novosMacros.slice(i, i + 50);
      const { error } = await supabase.from('MacroEvento').insert(batch);
      if (!error) {
        salvos += batch.length;
      } else {
        console.error(`Erro ao salvar lote: ${error.message}`);
      }
      if (i + 50 < novosMacros.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  return { veiculos_processados: processados, novos_macros: salvos, periodo: `${date_inicio} a ${date_fim}` };
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

  const { date_inicio, date_fim, company_id } = body;

  try {
    if (date_inicio && date_fim && company_id) {
      const empresas = await db.entities.Empresa.filter({ id: company_id }, '-created_date', 1);
      const empresa = empresas?.[0];

      if (!empresa) {
        return Response.json({ error: 'Empresa não encontrada' }, { status: 404 });
      }

      const result = await sincronizarMacrosEmpresa(db, supabase, empresa, date_inicio, date_fim);
      return Response.json({ success: true, ...result });
    }

    const agora = new Date();
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
    const inicioPadrao = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(agora.getTime() - 2 * 24 * 60 * 60 * 1000));
    const empresas = await db.entities.Empresa.filter({ provedora_rastreamento: 'autotrac', ativa: true }, '-created_date', 100);

    if (!empresas?.length) {
      return Response.json({ success: true, message: 'Nenhuma empresa ativa encontrada', results: [] });
    }

    const results = [];
    for (const empresa of empresas) {
      try {
        const result = await sincronizarMacrosEmpresa(db, supabase, empresa, inicioPadrao, hoje);
        results.push({ empresa: empresa.nome, ...result });
      } catch (error) {
        console.error(`Erro macros ${empresa.nome}:`, error.message);
        results.push({ empresa: empresa.nome, error: error.message });
      }
    }

    return Response.json({ success: true, scheduled: true, periodo: `${inicioPadrao} a ${hoje}`, results });
  } catch (e) {
    console.error('Erro sincronizarMacros:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
});