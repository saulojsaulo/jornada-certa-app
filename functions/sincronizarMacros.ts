import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const BASE_URL = 'https://aapi3.autotrac-online.com.br/aticapi/v1';
const MACROS_VALIDAS = new Set([1, 2, 3, 4, 5, 6, 9, 10]);
const MACROS_REGEX = /^\d+$/;
const LOTE_SIZE = 25; // veículos por execução
const CHUNK_SIZE = 3; // requisições paralelas simultâneas à Autotrac

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
  const timeout = setTimeout(() => controller.abort(), 20000);
  let res;
  try {
    res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error(`Timeout: ${url}`);
    throw e;
  }
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status}: ${txt.substring(0, 200)}`);
  }
  return res.json();
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const body = await req.json().catch(() => ({}));
  const offset    = Number(body.offset || 0);
  const horas     = Number(body.horas  || 24); // janela total desejada
  // A API Autotrac é muito lenta com janelas > 1h, por isso usamos janela de 1h por chamada
  // e o frontend/automação deve chamar em sequência passando janela_offset
  const JANELA_H  = 1; // horas por fatia de API
  const janelaOff = Number(body.janela_offset || 0); // quantas horas atrás começa esta fatia

  const db = base44.asServiceRole;

  const empresas = await db.entities.Empresa.filter({ provedora_rastreamento: 'autotrac', ativa: true }, '-created_date', 100);
  if (!empresas?.length) return Response.json({ message: 'Nenhuma empresa Autotrac configurada.' });

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
      // 1. Buscar contas
      const accountsRaw = await autotracGet(`${BASE_URL}/accounts?_limit=500`, headers);
      const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
      const contas = accountNum ? accountList.filter(a => String(a.Number) === accountNum) : accountList;

      if (!contas.length) {
        results.push({ empresa: empresa.nome, error: `Conta ${accountNum} não encontrada.` });
        continue;
      }

      const accountCode = contas[0].Code;

      // 2. Buscar veículos cadastrados no sistema (com paginação)
      const veiculosSistema = await db.entities.Veiculo.filter({ company_id: empresa.id }, '-created_date', 500);

      // Lote: processar apenas LOTE_SIZE veículos por vez
      const lote = veiculosSistema.slice(offset, offset + LOTE_SIZE);
      const proximo = offset + LOTE_SIZE < veiculosSistema.length ? offset + LOTE_SIZE : null;

      // Mapa de veículo por número_frota (Code da Autotrac) e por placa
      const mapFrota = {};
      const mapPlaca = {};
      for (const v of veiculosSistema) {
        if (v.numero_frota) mapFrota[v.numero_frota.toUpperCase().trim()] = v;
        if (v.placa)        mapPlaca[v.placa.toUpperCase().trim()] = v;
      }

      // 3. Janela de busca: fatia de JANELA_H horas (ou intervalo explícito via from_iso/to_iso)
      let from, end;
      if (body.from_iso && body.to_iso) {
        from = new Date(body.from_iso);
        end  = new Date(body.to_iso);
      } else {
        const now = new Date();
        end  = new Date(now - janelaOff * 60 * 60 * 1000);
        from = new Date(end - JANELA_H * 60 * 60 * 1000);
      }
      const fmt  = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
      const totalHoras = Math.min(horas, 24);
      const proximaJanelaOff = janelaOff + JANELA_H < totalHoras ? janelaOff + JANELA_H : null;

      // Buscar TODOS os MacroEventos da empresa de uma só vez (para checar duplicatas em memória)
      const dataFromStr = from.toISOString().split('T')[0];

      // Buscar mensagens da Autotrac E macros do banco em paralelo, por veículo, em chunks pequenos
      const mensagensPorVeiculo = [];
      const macrosPorVeiculo = {};

      for (let i = 0; i < lote.length; i += CHUNK_SIZE) {
        const chunk = lote.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          chunk.map(async (veiculo) => {
            const vehicleCode = veiculo.numero_frota;

            // Buscar macros do banco para este veículo (no máximo 20 por dia)
            const macrosDb = await db.entities.MacroEvento.filter(
              { veiculo_id: veiculo.id, data_jornada: dataFromStr },
              '-data_criacao',
              20
            );
            macrosPorVeiculo[veiculo.id] = macrosDb;

            if (!vehicleCode) {
              mensagensPorVeiculo.push({ veiculo, mensagens: [] });
              return;
            }
            try {
              const r = await autotracGet(
                `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/returnmessages?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(end))}&_limit=500`,
                headers
              );
              mensagensPorVeiculo.push({ veiculo, mensagens: Array.isArray(r) ? r : (r.Data || r.data || []) });
            } catch {
              mensagensPorVeiculo.push({ veiculo, mensagens: [] });
            }
          })
        );
      }

      let savedCount = 0;
      const novosEventos = [];

      for (const { veiculo, mensagens } of mensagensPorVeiculo) {
        const macrosDb = macrosPorVeiculo[veiculo.id] || [];
        const manualKeys = new Set(
          macrosDb.filter(m => m.editado_manualmente).map(m => `${m.numero_macro}-${m.jornada_id}`)
        );

        for (const msg of mensagens) {
          const rawMacro = msg.MacroNumber ?? msg.Macro ?? msg.macro;
          // Aceitar apenas valores puramente numéricos inteiros
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
            m.jornada_id === jornadaId &&
            Math.abs(new Date(m.data_criacao) - dataEvento) < TOL_MS
          );
          if (duplicata) continue;

          // Capturar localização da mensagem
          const lat = msg.Latitude ?? msg.latitude ?? msg.Lat ?? msg.lat ?? null;
          const lon = msg.Longitude ?? msg.longitude ?? msg.Long ?? msg.lon ?? msg.Lng ?? msg.lng ?? null;
          const endereco = msg.Address ?? msg.address ?? msg.City ?? msg.city ?? msg.Location ?? msg.location ?? null;

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

      // Inserir em lotes de 50 para evitar payloads grandes
      for (let i = 0; i < novosEventos.length; i += 50) {
        const loteInsert = novosEventos.slice(i, i + 50);
        await db.entities.MacroEvento.bulkCreate(loteInsert);
      }

      results.push({
        empresa: empresa.nome,
        saved: savedCount,
        processados: lote.length,
        total_veiculos: veiculosSistema.length,
        proximo_offset: proximo,
        janela_offset: janelaOff,
        proxima_janela_offset: proximo ? null : proximaJanelaOff,
        janela: `${fmt(from)} -> ${fmt(end)}`,
      });

    } catch (e) {
      results.push({ empresa: empresa.nome, error: e.message });
    }
  }

  const payload = JSON.stringify({ success: true, timestamp: new Date().toISOString(), results });
  return new Response(payload, { headers: { 'Content-Type': 'application/json' } });
});