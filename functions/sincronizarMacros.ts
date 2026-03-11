import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { createClient } from 'npm:@supabase/supabase-js'; // Nova importação

const BASE_URL = 'https://aapi3.autotrac-online.com.br/aticapi/v1';
const MACROS_VALIDAS = new Set([1, 2, 3, 4, 5, 6, 9, 10]);
const MACROS_REGEX = /^\d+$/;

function autotracHeaders(usuario, senha, apiKey) {
  return {
    'Authorization': `Basic ${usuario}:${senha}`,
    'Ocp-Apim-Subscription-Key': apiKey,
    'Content-Type': 'application/json',
    'User-Agent': 'PostmanRuntime/7.37.0',
    'Cache-Control': 'no-cache',
  };
}

async function autotracGet(url, headers, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let res;
    try {
      res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeout);
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') throw new Error(`Timeout: ${url}`);
      throw e;
    }
    if (res.status === 429) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      throw new Error('Rate limit exceeded');
    }
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`${res.status}: ${txt.substring(0, 200)}`);
    }
    return res.json();
  }
}

const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

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
  const offset = Number(body.offset || 0);
  const LOTE_SIZE = 50; // veículos processados por lote (só para DB, não para API)

  const empresas = await db.entities.Empresa.filter({ provedora_rastreamento: 'autotrac', ativa: true }, '-created_date', 100);
  if (!empresas?.length) {
    return new Response(JSON.stringify({ message: 'Nenhuma empresa Autotrac configurada.' }), { headers: { 'Content-Type': 'application/json' } });
  }

  const results = [];

  for (const empresa of empresas) {
    const cfg = empresa.api_config || {};
    const usuario = cfg.autotrac_usuario || Deno.env.get('AUTOTRAC_USER');
    const senha   = cfg.autotrac_senha   || Deno.env.get('AUTOTRAC_PASS');
    const apiKey  = cfg.autotrac_api_key || Deno.env.get('AUTOTRAC_API_KEY');
    const accountNum = String(cfg.autotrac_account || Deno.env.get('AUTOTRAC_ACCOUNT') || '');

    if (!usuario || !senha || !apiKey) {
      results.push({ empresa: empresa.nome, error: 'Credenciais incompletas.' });
      continue;
    }

    const headers = autotracHeaders(usuario, senha, apiKey);

    try {
      // 1. Buscar accountCode (1 chamada)
      const accountsRaw = await autotracGet(`${BASE_URL}/accounts?_limit=500`, headers);
      const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
      const contas = accountNum ? accountList.filter(a => String(a.Number) === accountNum) : accountList;
      if (!contas.length) {
        results.push({ empresa: empresa.nome, error: `Conta ${accountNum} não encontrada.` });
        continue;
      }
      const accountCode = contas[0].Code;

      // 2. Janela de busca
      let from, end;
      if (body.from_iso && body.to_iso) {
        from = new Date(body.from_iso);
        end  = new Date(body.to_iso);
      } else {
        end  = new Date();
        from = new Date(end.getTime() - 24 * 3600 * 1000);
      }

      // 3. Buscar veículos do sistema (via Supabase)
      const { data: veiculosSistema, error: veiculoError } = await supabase
        .from('veiculos')
        .select('id, numero_frota')
        .eq('company_id', empresa.id)
        .order('created_date', { ascending: false })
        .limit(500);

      if (veiculoError) {
        results.push({ empresa: empresa.nome, error: `Erro ao buscar veículos no Supabase: ${veiculoError.message}` });
        continue;
      }

      const lote = veiculosSistema.slice(offset, offset + LOTE_SIZE);
      const proximo = offset + LOTE_SIZE < veiculosSistema.length ? offset + LOTE_SIZE : null;

      // Datas a checar para duplicatas
      const dataFromStr = from.toISOString().split('T')[0];
      const dataEndStr  = end.toISOString().split('T')[0];
      const datasParaChecar = dataFromStr === dataEndStr ? [dataFromStr] : [dataFromStr, dataEndStr];

      // 4. Para cada veículo: buscar macros do banco (via Supabase) + mensagens da API (sequencial com delay)
      const mensagensPorVeiculo = [];
      const macrosPorVeiculo = {};

      for (const veiculo of lote) {
        // Buscar macros existentes no banco (via Supabase)
        const fetches = await Promise.all(
          datasParaChecar.map(async (d) => {
            const { data: macros, error: macroError } = await supabase
              .from('macro_eventos')
              .select('*')
              .eq('veiculo_id', veiculo.id)
              .eq('data_jornada', d)
              .order('data_criacao', { ascending: false })
              .limit(50);
            
            if (macroError) {
              console.error(`Erro ao buscar macros para veículo ${veiculo.id} e data ${d} no Supabase: ${macroError.message}`);
              return [];
            }
            return macros;
          })
        );
        macrosPorVeiculo[veiculo.id] = fetches.flat();

        // Buscar mensagens da API Autotrac
        const vehicleCode = String(veiculo.numero_frota || '');
        if (!vehicleCode) {
          mensagensPorVeiculo.push({ veiculo, mensagens: [] });
          continue;
        }
        try {
          const r = await autotracGet(
            `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/returnmessages?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(end))}&_limit=500`,
            headers
          );
          mensagensPorVeiculo.push({ veiculo, mensagens: Array.isArray(r) ? r : (r.Data || r.data || []) });
        } catch(e) {
          console.error(`Erro ao buscar mensagens Autotrac para veículo ${veiculo.numero_frota}: ${e.message}`);
          mensagensPorVeiculo.push({ veiculo, mensagens: [] });
        }
        // Pausa para respeitar rate limit
        await new Promise(r => setTimeout(r, 1000));
      }

      // 5. Processar e inserir novos eventos
      let savedCount = 0;
      const novosEventos = [];

      for (const { veiculo, mensagens } of mensagensPorVeiculo) {
        const macrosDb = macrosPorVeiculo[veiculo.id] || [];

        const manualKeys = new Set(
          macrosDb.filter(m => m.editado_manualmente).map(m => `${m.numero_macro}-${m.jornada_id}`)
        );

        for (const msg of mensagens) {
          const rawMacro = msg.MacroNumber ?? msg.Macro ?? msg.macro;
          if (rawMacro === null || rawMacro === undefined) continue;
          if (typeof rawMacro === 'string' && !MACROS_REGEX.test(rawMacro.trim())) continue;
          const numeroMacro = Number(rawMacro);
          if (!Number.isInteger(numeroMacro) || !MACROS_VALIDAS.has(numeroMacro)) continue;

          const dataCriacao = msg.MessageTime || msg.DateTime || msg.Date || msg.dateTime || msg.date;
          if (!dataCriacao) continue;
          const dataEvento = new Date(dataCriacao);
          if (isNaN(dataEvento.getTime())) continue;

          const dataStr   = dataEvento.toISOString().split('T')[0];
          const jornadaId = `${veiculo.id}-${dataStr}`;

          if (manualKeys.has(`${numeroMacro}-${jornadaId}`)) continue;

          const TOL_MS = 2 * 60 * 1000;
          const duplicata = macrosDb.some(m =>
            m.numero_macro === numeroMacro &&
            m.jornada_id   === jornadaId &&
            Math.abs(new Date(m.data_criacao) - dataEvento) < TOL_MS
          );
          if (duplicata) continue;

          const lat     = msg.Latitude  ?? msg.latitude  ?? msg.Lat ?? msg.lat ?? null;
          const lon     = msg.Longitude ?? msg.longitude ?? msg.Long ?? msg.lon ?? msg.Lng ?? msg.lng ?? null;
          const endereco = msg.Address  ?? msg.address   ?? msg.City ?? msg.city ?? msg.Location ?? msg.location ?? null;

          novosEventos.push({
            veiculo_id: veiculo.id,
            numero_macro: numeroMacro,
            data_criacao: dataEvento.toISOString(),
            jornada_id: jornadaId,
            data_jornada: dataStr,
            excluido: false,
            editado_manualmente: false,
            company_id: empresa.id,
            ...(lat !== null && { latitude: Number(lat) }),
            ...(lon !== null && { longitude: Number(lon) }),
            ...(endereco ? { endereco: String(endereco) } : {}),
          });
          savedCount++;
        }
      }

      // Inserir em lotes de 100 (via Supabase)
      for (let i = 0; i < novosEventos.length; i += 100) {
        const { error: insertError } = await supabase
          .from('macro_eventos')
          .insert(novosEventos.slice(i, i + 100));
        
        if (insertError) {
          console.error(`Erro ao inserir macros no Supabase: ${insertError.message}`);
          // Dependendo da sua necessidade, você pode querer lançar um erro ou adicionar a results aqui.
        }
      }

      results.push({
        empresa: empresa.nome,
        saved: savedCount,
        processados: lote.length,
        total_veiculos: veiculosSistema.length,

        proximo_offset: proximo,
        janela: `${fmt(from)} -> ${fmt(end)}`,
      });

    } catch (e) {
      results.push({ empresa: empresa.nome, error: e.message });
    }
  }

  return new Response(JSON.stringify({ success: true, timestamp: new Date().toISOString(), results }), {
    headers: { 'Content-Type': 'application/json' }
  });
});