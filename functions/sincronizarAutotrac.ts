import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const BASE_URL = 'https://aapi3.autotrac-online.com.br/aticapi/v1';

// Números de macro válidos que o sistema reconhece
const MACROS_VALIDAS = new Set([1, 2, 3, 4, 5, 6, 9, 10]);

function autotracHeaders(usuario, senha, apiKey) {
  return {
    'Authorization': `Basic ${btoa(`${usuario}:${senha}`)}`,
    'x-api-key': apiKey,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'PostmanRuntime/7.37.0',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
  };
}

async function autotracGet(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GET ${url} → ${res.status}: ${txt.substring(0, 200)}`);
  }
  return res.json();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Aceita chamada autenticada (admin) ou via automação agendada (sem token)
    try {
      const user = await base44.auth.me();
      if (user?.role !== 'admin') {
        return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
      }
    } catch {
      // Chamada via automação — sem usuário autenticado, continua como service role
    }

    const db = base44.asServiceRole;

    // 1. Buscar todas as empresas com Autotrac ativa
    const empresas = await db.entities.Empresa.filter({
      provedora_rastreamento: 'autotrac',
      ativa: true,
    });

    if (!empresas || empresas.length === 0) {
      return Response.json({ message: 'Nenhuma empresa com Autotrac configurada.', synced: 0 });
    }

    const results = [];

    for (const empresa of empresas) {
      const cfg = empresa.api_config || {};

      // Credenciais: prioriza api_config da empresa, fallback para secrets globais
      const usuario = cfg.autotrac_usuario || Deno.env.get('AUTOTRAC_USER');
      const senha   = cfg.autotrac_senha   || Deno.env.get('AUTOTRAC_PASS');
      const apiKey  = cfg.autotrac_api_key || Deno.env.get('AUTOTRAC_API_KEY');

      if (!usuario || !senha || !apiKey) {
        results.push({ empresa: empresa.nome, error: 'Credenciais incompletas (usuário, senha ou api_key).' });
        continue;
      }

      const headers = autotracHeaders(usuario, senha, apiKey);
      let savedCount = 0;
      let skippedCount = 0;
      let errorMsg = null;

      try {
        // 2. Buscar contas ativas da companhia
        const accounts = await autotracGet(`${BASE_URL}/accounts`, headers);
        const accountList = Array.isArray(accounts) ? accounts : (accounts.data || accounts.items || [accounts]);

        // Buscar veículos cadastrados no sistema para mapear identificadores -> veiculo
        const veiculosSistema = await db.entities.Veiculo.filter({ company_id: empresa.id });
        const veiculoMapPlaca = {};
        const veiculoMapFrota = {};
        for (const v of veiculosSistema) {
          if (v.placa) veiculoMapPlaca[v.placa.toUpperCase().trim()] = v;
          if (v.numero_frota) veiculoMapFrota[v.numero_frota.toUpperCase().trim()] = v;
        }

        // Número de conta configurado na empresa (campo autotrac_account guarda o Number)
        const accountNumber = cfg.autotrac_account || Deno.env.get('AUTOTRAC_ACCOUNT');

        for (const account of accountList) {
          // A API exige o campo "Code" (ID interno) nas URLs — não o "Number"
          // Se o usuário configurou um número de conta específico, filtra apenas essa conta
          if (accountNumber && String(account.Number) !== String(accountNumber)) continue;

          const accountCode = account.Code; // <-- campo mágico para as URLs
          if (!accountCode) continue;

          // 3. Buscar veículos ativos da conta
          let veiculosApi = [];
          try {
            const vRes = await autotracGet(`${BASE_URL}/accounts/${accountCode}/vehicles`, headers);
            veiculosApi = Array.isArray(vRes) ? vRes : (vRes.data || vRes.items || []);
          } catch (e) {
            results.push({ empresa: empresa.nome, account: accountCode, error: `Erro ao buscar veículos: ${e.message}` });
            continue;
          }

          for (const veiApi of veiculosApi) {
            const vehicleCode = veiApi.code || veiApi.id;
            if (!vehicleCode) continue;

            // Encontrar o veículo correspondente no sistema pelo nome/placa/frota
            const placa = (veiApi.plate || veiApi.placa || '').toUpperCase().trim();
            const frota = (veiApi.fleetNumber || veiApi.frota || veiApi.fleet || String(vehicleCode)).toUpperCase().trim();
            const veiculo = veiculoMapPlaca[placa] || veiculoMapFrota[frota];

            if (!veiculo) {
              // Veículo da Autotrac não está cadastrado no sistema — pular
              skippedCount++;
              continue;
            }

            // 4. Buscar returnmessages (contêm os macros) do veículo
            let mensagens = [];
            try {
              const mRes = await autotracGet(
                `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/returnmessages`,
                headers
              );
              mensagens = Array.isArray(mRes) ? mRes : (mRes.data || mRes.items || []);
            } catch (e) {
              // Não crítico — continua para o próximo veículo
              continue;
            }

            for (const msg of mensagens) {
              // Extrair número de macro e data do retorno da Autotrac
              // Ajuste os campos conforme o contrato real da API (ex: msg.macro, msg.macroNumber, msg.type)
              const numeroMacro = Number(msg.macro || msg.macroNumber || msg.macroCode || msg.type || 0);
              const dataCriacao = msg.dateTime || msg.date || msg.timestamp || msg.dataHora;

              if (!MACROS_VALIDAS.has(numeroMacro) || !dataCriacao) continue;

              const dataEvento = new Date(dataCriacao);
              if (isNaN(dataEvento.getTime())) continue;

              const dataStr = dataEvento.toISOString().split('T')[0];
              const jornadaId = `${veiculo.id}-${dataStr}`;

              // Verificar duplicata: mesmo veiculo + macro + jornada_id
              const existing = await db.entities.MacroEvento.filter({
                veiculo_id: veiculo.id,
                numero_macro: numeroMacro,
                jornada_id: jornadaId,
              });

              // Tolerância de 2 minutos para considerar o mesmo evento
              const TOL_MS = 2 * 60 * 1000;
              const jaExiste = existing.some(e => Math.abs(new Date(e.data_criacao) - dataEvento) < TOL_MS);
              if (jaExiste) continue;

              // Não sobrescrever registros editados manualmente
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
      } catch (e) {
        errorMsg = e.message;
      }

      results.push({
        empresa: empresa.nome,
        saved: savedCount,
        skipped_vehicles: skippedCount,
        ...(errorMsg ? { error: errorMsg } : {}),
      });
    }

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      results,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});