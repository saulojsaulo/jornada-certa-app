import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const BASE_URL = 'https://aapi3.autotrac-online.com.br/aticapi/v1';

// Números de macro válidos que o sistema reconhece (1-6, 9, 10)
const MACROS_VALIDAS = new Set([1, 2, 3, 4, 5, 6, 9, 10]);

function autotracHeaders(usuario, senha, apiKey) {
  // Conforme documentação Autotrac:
  // Authorization: Basic usuario@companhia:senha (credenciais raw, sem btoa)
  // Ocp-Apim-Subscription-Key: chave gerada pelo Home Office
  return {
    'Authorization': `Basic ${usuario}:${senha}`,
    'Ocp-Apim-Subscription-Key': apiKey,
    'Content-Type': 'application/json',
    'User-Agent': 'PostmanRuntime/7.37.0',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
  };
}

async function autotracGet(url, headers) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') {
      throw new Error(`Timeout(15s): ${url} — cadastre o IP do servidor no Home Office Autotrac`);
    }
    throw e;
  }
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${txt.substring(0, 300)}`);
  }
  return res.json();
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Aceita chamada autenticada (admin) ou via automação agendada
  try {
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }
  } catch {
    // Chamada via automação — sem token de usuário, usa service role
  }

  const db = base44.asServiceRole;
  const log = []; // log de diagnóstico retornado no response

  // 1. Buscar empresas com Autotrac ativa
  const empresas = await db.entities.Empresa.filter({ provedora_rastreamento: 'autotrac', ativa: true });

  if (!empresas || empresas.length === 0) {
    return Response.json({ message: 'Nenhuma empresa com Autotrac configurada.', synced: 0 });
  }

  const results = [];

  for (const empresa of empresas) {
    const cfg = empresa.api_config || {};
    const usuario     = cfg.autotrac_usuario || Deno.env.get('AUTOTRAC_USER');
    const senha       = cfg.autotrac_senha   || Deno.env.get('AUTOTRAC_PASS');
    const apiKey      = cfg.autotrac_api_key || Deno.env.get('AUTOTRAC_API_KEY');
    const accountNum  = String(cfg.autotrac_account || Deno.env.get('AUTOTRAC_ACCOUNT') || '');

    if (!usuario || !senha || !apiKey) {
      results.push({ empresa: empresa.nome, error: 'Credenciais incompletas.' });
      continue;
    }

    const headers = autotracHeaders(usuario, senha, apiKey);
    const empresaLog = { empresa: empresa.nome, usuario, accountNum, steps: [] };

    let savedCount = 0;
    let skippedCount = 0;

    try {
      // 2. Buscar todas as contas da companhia
      const accountsRaw = await autotracGet(`${BASE_URL}/accounts?_limit=500`, headers);
      const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || accountsRaw.data || accountsRaw.items || []);
      empresaLog.steps.push(`/accounts retornou ${accountList.length} contas`);
      empresaLog.accountsSample = accountList.slice(0, 3).map(a => ({ Code: a.Code, Number: a.Number, Name: a.Name }));

      // Filtrar pelo Number configurado (se informado) e capturar o Code interno
      const contasFiltradas = accountNum
        ? accountList.filter(a => String(a.Number) === accountNum)
        : accountList;

      empresaLog.steps.push(`Contas após filtro pelo Number "${accountNum}": ${contasFiltradas.length}`);

      if (contasFiltradas.length === 0) {
        results.push({ empresa: empresa.nome, warning: `Nenhuma conta encontrada com Number="${accountNum}"`, log: empresaLog });
        continue;
      }

      // Mapa de veículos do sistema
      const veiculosSistema = await db.entities.Veiculo.filter({ company_id: empresa.id });
      const veiculoMapPlaca = {};
      const veiculoMapFrota = {};
      for (const v of veiculosSistema) {
        if (v.placa)        veiculoMapPlaca[v.placa.toUpperCase().trim()] = v;
        if (v.numero_frota) veiculoMapFrota[v.numero_frota.toUpperCase().trim()] = v;
      }
      empresaLog.steps.push(`Veículos no sistema: ${veiculosSistema.length}`);

      for (const account of contasFiltradas) {
        const accountCode = account.Code; // campo interno usado nas URLs
        empresaLog.steps.push(`Processando conta Code=${accountCode} Number=${account.Number} Name=${account.Name}`);

        // 3. Buscar veículos ativos da conta
        const veiculosRaw = await autotracGet(`${BASE_URL}/accounts/${accountCode}/vehicles`, headers);
        const veiculosApi = Array.isArray(veiculosRaw) ? veiculosRaw : (veiculosRaw.Data || veiculosRaw.data || veiculosRaw.items || []);
        empresaLog.steps.push(`Veículos na Autotrac (conta ${accountCode}): ${veiculosApi.length}`);
        empresaLog.vehiclesSample = veiculosApi.slice(0, 3);

        // Janela de busca: últimas 72h (máximo permitido pela API)
        const now  = new Date();
        const from = new Date(now - 72 * 60 * 60 * 1000);
        const fmt  = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

        for (const veiApi of veiculosApi) {
          const vehicleCode = veiApi.Code || veiApi.code;
          if (!vehicleCode) continue;

          const placa = (veiApi.LicensePlate || veiApi.Plate || veiApi.plate || veiApi.placa || '').toUpperCase().trim();
          const frota = (veiApi.Fleet || veiApi.fleet || veiApi.frota || String(vehicleCode)).toUpperCase().trim();
          const nome  = veiApi.Name || veiApi.name || placa || frota || String(vehicleCode);
          let veiculo = veiculoMapPlaca[placa] || veiculoMapFrota[frota];

          // Criar veículo automaticamente se não existir no sistema
          if (!veiculo) {
            veiculo = await db.entities.Veiculo.create({
              nome_veiculo: nome,
              placa: placa || undefined,
              numero_frota: frota || undefined,
              ativo: true,
              company_id: empresa.id,
            });
            if (placa)  veiculoMapPlaca[placa]  = veiculo;
            if (frota)  veiculoMapFrota[frota]  = veiculo;
            empresaLog.steps.push(`Veículo criado automaticamente: ${nome} (placa=${placa}, frota=${frota})`);
          }

          // 4. Buscar returnmessages (macros) do veículo
          let mensagens = [];
          try {
            const mRes = await autotracGet(
              `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/returnmessages?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=500`,
              headers
            );
            mensagens = Array.isArray(mRes) ? mRes : [];
          } catch {
            continue; // falha num veículo não interrompe os demais
          }

          for (const msg of mensagens) {
            const numeroMacro = Number(msg.Macro || msg.MacroNumber || msg.macro || msg.macroNumber || 0);
            const dataCriacao = msg.DateTime || msg.Date || msg.dateTime || msg.date;

            if (!MACROS_VALIDAS.has(numeroMacro) || !dataCriacao) continue;

            const dataEvento = new Date(dataCriacao);
            if (isNaN(dataEvento.getTime())) continue;

            const dataStr  = dataEvento.toISOString().split('T')[0];
            const jornadaId = `${veiculo.id}-${dataStr}`;

            const existing = await db.entities.MacroEvento.filter({
              veiculo_id: veiculo.id,
              numero_macro: numeroMacro,
              jornada_id: jornadaId,
            });

            const TOL_MS = 2 * 60 * 1000;
            if (existing.some(e => Math.abs(new Date(e.data_criacao) - dataEvento) < TOL_MS)) continue;
            if (existing.some(e => e.editado_manualmente)) continue;

            await db.entities.MacroEvento.create({
              veiculo_id: veiculo.id,
              numero_macro: numeroMacro,
              data_criacao: dataEvento.toISOString(),
              jornada_id: jornadaId,
              data_jornada: dataStr,
              excluido: false,
              editado_manualmente: false,
              company_id: empresa.id,
            });

            savedCount++;
          }
        }
      }

      results.push({ empresa: empresa.nome, saved: savedCount, skipped_vehicles: skippedCount, log: empresaLog });

    } catch (e) {
      results.push({ empresa: empresa.nome, error: e.message, log: empresaLog });
    }
  }

  return Response.json({ success: true, timestamp: new Date().toISOString(), results });
});