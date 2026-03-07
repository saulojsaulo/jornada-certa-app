import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

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
  try {
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
  } catch {}

  const db = base44.asServiceRole;

  const empresas = await db.entities.Empresa.filter({ provedora_rastreamento: 'autotrac', ativa: true });
  if (!empresas?.length) return Response.json({ message: 'Nenhuma empresa Autotrac configurada.' });

  const results = [];

  for (const empresa of empresas) {
    const cfg = empresa.api_config || {};
    const usuario    = cfg.autotrac_usuario || Deno.env.get('AUTOTRAC_USER');
    const senha      = cfg.autotrac_senha   || Deno.env.get('AUTOTRAC_PASS');
    const apiKey     = cfg.autotrac_api_key || Deno.env.get('AUTOTRAC_API_KEY');
    const accountNum = String(cfg.autotrac_account || Deno.env.get('AUTOTRAC_ACCOUNT') || '');

    if (!usuario || !senha || !apiKey) {
      results.push({ empresa: empresa.nome, error: 'Credenciais incompletas.' });
      continue;
    }

    const headers = autotracHeaders(usuario, senha, apiKey);

    try {
      // 1. Buscar contas e filtrar pelo Number configurado
      const accountsRaw = await autotracGet(`${BASE_URL}/accounts?_limit=500`, headers);
      const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
      const contas = accountNum ? accountList.filter(a => String(a.Number) === accountNum) : accountList;

      if (!contas.length) {
        results.push({ empresa: empresa.nome, error: `Conta ${accountNum} não encontrada.` });
        continue;
      }

      // 2. Carregar veículos já cadastrados no sistema
      const veiculosSistema = await db.entities.Veiculo.filter({ company_id: empresa.id });
      const mapPlaca = {};
      const mapFrota = {};
      for (const v of veiculosSistema) {
        if (v.placa)        mapPlaca[v.placa.toUpperCase().trim()] = v;
        if (v.numero_frota) mapFrota[v.numero_frota.toUpperCase().trim()] = v;
      }

      let criados = 0;
      let existentes = 0;

      for (const account of contas) {
        const accountCode = account.Code;

        // 3. Buscar todos os veículos com paginação
        let page = 1;
        while (true) {
          const pageRaw = await autotracGet(`${BASE_URL}/accounts/${accountCode}/vehicles?_limit=100&_page=${page}`, headers);
          const pageData = Array.isArray(pageRaw) ? pageRaw : (pageRaw.Data || []);
          if (!pageData.length) break;

          for (const veiApi of pageData) {
            const vehicleCode = String(veiApi.Code || '');
            if (!vehicleCode) continue;

            const placa = (veiApi.LicensePlate || '').toUpperCase().trim();
            const frota = vehicleCode; // usa o Code como identificador de frota
            const nome  = (veiApi.Name || placa || frota).trim();

            if (mapPlaca[placa] || mapFrota[frota]) {
              existentes++;
              continue;
            }

            // Criar veículo novo
            const novo = await db.entities.Veiculo.create({
              nome_veiculo: nome,
              placa: placa || undefined,
              numero_frota: frota,
              ativo: true,
              company_id: empresa.id,
            });

            if (placa) mapPlaca[placa] = novo;
            mapFrota[frota] = novo;
            criados++;
          }

          if (pageData.length < 100) break;
          page++;
        }
      }

      results.push({ empresa: empresa.nome, criados, existentes });

    } catch (e) {
      results.push({ empresa: empresa.nome, error: e.message });
    }
  }

  return Response.json({ success: true, timestamp: new Date().toISOString(), results });
});