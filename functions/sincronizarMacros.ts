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

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  );

  let body = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ 
      error: 'Parâmetros obrigatórios: date_inicio, date_fim, company_id' 
    }, { status: 400 });
  }
  
  const { date_inicio, date_fim, company_id } = body;

  if (!date_inicio || !date_fim || !company_id) {
    return Response.json({ 
      error: 'Parâmetros obrigatórios: date_inicio, date_fim, company_id' 
    }, { status: 400 });
  }

  try {
    // Buscar empresa via Supabase
    const { data: empresa } = await supabase
      .from('Empresa')
      .select('*')
      .eq('id', company_id)
      .single();

    if (!empresa) {
      return Response.json({ error: 'Empresa não encontrada' }, { status: 404 });
    }

    const cfg = empresa.api_config || {};
    const usuario = cfg.autotrac_usuario || Deno.env.get('AUTOTRAC_USER');
    const senha = cfg.autotrac_senha || Deno.env.get('AUTOTRAC_PASS');
    const apiKey = cfg.autotrac_api_key || Deno.env.get('AUTOTRAC_API_KEY');
    const accountNum = String(cfg.autotrac_account || Deno.env.get('AUTOTRAC_ACCOUNT') || '');

    if (!usuario || !senha || !apiKey) {
      return Response.json({ error: 'Credenciais Autotrac não configuradas' }, { status: 500 });
    }

    const headers = autotracHeaders(usuario, senha, apiKey);

    // Buscar account code
    const accountsRes = await fetchComRetry(`${BASE_URL}/accounts?_limit=500`, { headers });
    const accountsRaw = await accountsRes.json();
    const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
    const conta = accountNum ? accountList.find(a => String(a.Number) === accountNum) : accountList[0];
    
    if (!conta) {
      return Response.json({ error: 'Conta Autotrac não encontrada' }, { status: 404 });
    }

    const accountCode = conta.Code;

    // Buscar veículos via Supabase
    const { data: veiculos } = await supabase
      .from('Veiculo')
      .select('*')
      .eq('company_id', company_id)
      .eq('ativo', true)
      .limit(500);

    if (!veiculos?.length) {
      return Response.json({ error: 'Nenhum veículo encontrado' }, { status: 404 });
    }

    const vehicleCodes = veiculos.map(v => v.numero_frota).filter(Boolean);

    // Buscar macros existentes para evitar duplicatas
    const { data: macrosExistentes } = await supabase
      .from('MacroEvento')
      .select('veiculo_id, numero_macro, data_criacao')
      .eq('company_id', company_id)
      .gte('data_criacao', `${date_inicio}T00:00:00`)
      .lte('data_criacao', `${date_fim}T23:59:59`);

    const existentesSet = new Set(
      (macrosExistentes || []).map(m => 
        `${m.veiculo_id}-${m.numero_macro}-${new Date(m.data_criacao).toISOString()}`
      )
    );

    const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
    const startDate = new Date(`${date_inicio}T00:00:00-03:00`);
    const endDate = new Date(`${date_fim}T23:59:59-03:00`);

    const novosMacros = [];
    let processados = 0;

    // Processar em lotes de 3 veículos
    for (let i = 0; i < vehicleCodes.length; i += 3) {
      const batch = vehicleCodes.slice(i, i + 3);
      
      await Promise.all(batch.map(async (vehicleCode) => {
        try {
          const veiculo = veiculos.find(v => v.numero_frota === vehicleCode);
          if (!veiculo) return;

          // Buscar macros da API com paginação
          let offset = 0;
          const limit = 200;
          let hasMore = true;

          while (hasMore) {
            const url = `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/macros?startDate=${encodeURIComponent(fmt(startDate))}&endDate=${encodeURIComponent(fmt(endDate))}&_limit=${limit}&_offset=${offset}`;
            
            const res = await fetchComRetry(url, { headers });
            
            if (!res.ok) {
              if (res.status === 422) break; // Veículo não autorizado
              console.error(`Erro ${res.status} para veículo ${vehicleCode}`);
              break;
            }

            const data = await res.json();
            const items = Array.isArray(data) ? data : (data.Data || data.data || []);

            if (!items.length) {
              hasMore = false;
              break;
            }

            // Processar macros
            for (const macro of items) {
              const numeroMacro = normalizarMacro(macro.Macro || macro.macro);
              if (!numeroMacro) continue;

              const dataEvento = new Date(macro.MacroTime || macro.ReceivedTime);
              const chave = `${veiculo.id}-${numeroMacro}-${dataEvento.toISOString()}`;

              if (existentesSet.has(chave)) continue;

              novosMacros.push({
                veiculo_id: veiculo.id,
                numero_macro: numeroMacro,
                data_criacao: dataEvento.toISOString(),
                latitude: macro.Latitude || null,
                longitude: macro.Longitude || null,
                endereco: macro.Landmark || null,
                company_id: company_id,
                excluido: false,
                editado_manualmente: false,
              });
            }

            offset += limit;
            if (items.length < limit) hasMore = false;
            
            await new Promise(r => setTimeout(r, 300));
          }

          processados++;
        } catch (e) {
          console.error(`Erro ao processar ${vehicleCode}: ${e.message}`);
        }
      }));

      await new Promise(r => setTimeout(r, 1000));
    }

    // Salvar novos macros no Supabase em lotes
    let salvos = 0;
    if (novosMacros.length > 0) {
      for (let i = 0; i < novosMacros.length; i += 50) {
        const batch = novosMacros.slice(i, i + 50);
        const { error } = await supabase
          .from('MacroEvento')
          .insert(batch);
        
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

    return Response.json({
      success: true,
      veiculos_processados: processados,
      novos_macros: salvos,
      periodo: `${date_inicio} a ${date_fim}`,
    });

  } catch (e) {
    console.error('Erro sincronizarMacros:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
});