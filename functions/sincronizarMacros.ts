import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const BASE_URL = 'https://aapi3.autotrac-online.com.br/aticapi/v1';
const MACROS_VALIDAS = new Set([1, 2, 3, 4, 5, 6, 9, 10]);
const LOTE_SIZE = 10; // veículos processados por execução

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
  const timeout = setTimeout(() => controller.abort(), 15000);
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

  // Parâmetro opcional: offset de veículos para processar em lotes via automação
  const body = await req.json().catch(() => ({}));
  const offset = Number(body.offset || 0);
  const horas  = Number(body.horas  || 24); // janela de busca em horas (max 72)

  const db = base44.asServiceRole;

  const empresas = await db.entities.Empresa.filter({ provedora_rastreamento: 'autotrac', ativa: true });
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
      const veiculosSistema = await db.entities.Veiculo.filter({ company_id: empresa.id });

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

      // 3. Janela de busca
      const now  = new Date();
      const from = new Date(now - Math.min(horas, 72) * 60 * 60 * 1000);
      const fmt  = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

      let savedCount = 0;

      // Buscar mensagens de todos os veículos do lote em paralelo
      const resultadosLote = await Promise.all(
        lote.map(async (veiculo) => {
          const vehicleCode = veiculo.numero_frota;
          if (!vehicleCode) return { veiculo, mensagens: [] };
          try {
            const mRes = await autotracGet(
              `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/returnmessages?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=500`,
              headers
            );
            const mensagens = Array.isArray(mRes) ? mRes : (mRes.Data || mRes.data || []);
            return { veiculo, mensagens };
          } catch {
            return { veiculo, mensagens: [] };
          }
        })
      );

      for (const { veiculo, mensagens } of resultadosLote) {
        for (const msg of mensagens) {
          const numeroMacro = Number(msg.Macro || msg.MacroNumber || msg.macro || 0);
          const dataCriacao = msg.DateTime || msg.Date || msg.dateTime || msg.date;

          if (!MACROS_VALIDAS.has(numeroMacro) || !dataCriacao) continue;

          const dataEvento = new Date(dataCriacao);
          if (isNaN(dataEvento.getTime())) continue;

          const dataStr   = dataEvento.toISOString().split('T')[0];
          const jornadaId = `${veiculo.id}-${dataStr}`;

          // Verificar duplicata
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

      results.push({
        empresa: empresa.nome,
        saved: savedCount,
        processados: lote.length,
        total_veiculos: veiculosSistema.length,
        proximo_offset: proximo,
      });

    } catch (e) {
      results.push({ empresa: empresa.nome, error: e.message });
    }
  }

  return Response.json({ success: true, timestamp: new Date().toISOString(), results });
});