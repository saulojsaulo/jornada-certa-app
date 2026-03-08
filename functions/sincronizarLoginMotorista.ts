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
  const timeout = setTimeout(() => controller.abort(), 25000);
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

// Normaliza CPF: remove pontos, traços e espaços
function normalizarCPF(cpf) {
  if (!cpf) return '';
  return String(cpf).replace(/[\.\-\s]/g, '').trim();
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  // Permite chamada por automação (sem usuário) ou por admin
  try {
    const user = await base44.auth.me();
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  } catch {}

  const db = base44.asServiceRole;

  const empresas = await db.entities.Empresa.filter({ provedora_rastreamento: 'autotrac', ativa: true });
  if (!empresas?.length) return Response.json({ message: 'Nenhuma empresa Autotrac configurada.' });

  // Janela de busca: últimas 2h para garantir que não perca eventos
  const now  = new Date();
  const from = new Date(now - 2 * 60 * 60 * 1000);
  const fmt  = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

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
      // 1. Buscar conta
      const accountsRaw = await autotracGet(`${BASE_URL}/accounts?_limit=500`, headers);
      const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
      const contas = accountNum ? accountList.filter(a => String(a.Number) === accountNum) : accountList;

      if (!contas.length) {
        results.push({ empresa: empresa.nome, error: `Conta ${accountNum} não encontrada.` });
        continue;
      }

      const accountCode = contas[0].Code;

      // 2. Buscar dados do sistema em paralelo
      const [veiculosSistema, motoristasSistema] = await Promise.all([
        db.entities.Veiculo.filter({ company_id: empresa.id }),
        db.entities.Motorista.filter({ company_id: empresa.id }),
      ]);

      // Mapa CPF -> motorista
      const mapCPF = {};
      for (const m of motoristasSistema) {
        const cpfNorm = normalizarCPF(m.cpf);
        if (cpfNorm) mapCPF[cpfNorm] = m;
      }

      // Mapa placa -> veiculo e frota -> veiculo
      const mapPlaca = {};
      const mapFrota = {};
      for (const v of veiculosSistema) {
        if (v.placa)        mapPlaca[v.placa.toUpperCase().trim()] = v;
        if (v.numero_frota) mapFrota[v.numero_frota.toUpperCase().trim()] = v;
      }

      // 3. Buscar logs de login/logout da janela
      const logsRaw = await autotracGet(
        `${BASE_URL}/accounts/${accountCode}/drivervehiclelog?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=500`,
        headers
      );
      const logs = Array.isArray(logsRaw) ? logsRaw : (logsRaw.Data || []);

      if (!logs.length) {
        results.push({ empresa: empresa.nome, atualizados: 0, logs_recebidos: 0 });
        continue;
      }

      // 4. Para cada veículo, pegar o evento mais recente e decidir o motorista atual
      // Agrupamos os logs por veículo (pela placa ou nome)
      const logsPorVeiculo = {};
      for (const log of logs) {
        const chave = (log.VehicleLicensePlate || log.VehicleName || '').toUpperCase().trim();
        if (!chave) continue;
        if (!logsPorVeiculo[chave]) logsPorVeiculo[chave] = [];
        logsPorVeiculo[chave].push(log);
      }

      let atualizados = 0;
      const updates = [];

      for (const [chave, eventos] of Object.entries(logsPorVeiculo)) {
        // Identificar o veículo no sistema
        const veiculo = mapPlaca[chave] || mapFrota[chave];
        if (!veiculo) continue;

        // Ordenar por data mais recente
        eventos.sort((a, b) => {
          const ta = new Date(a.LoginTime || a.LogoutTime || 0).getTime();
          const tb = new Date(b.LoginTime || b.LogoutTime || 0).getTime();
          return tb - ta;
        });

        // O evento mais recente determina o estado atual
        const ultimo = eventos[0];
        const temLoginRecente = ultimo.LoginTime && (!ultimo.LogoutTime || new Date(ultimo.LoginTime) >= new Date(ultimo.LogoutTime));

        if (temLoginRecente) {
          // Motorista logado: vincular pelo CPF
          const cpfNorm = normalizarCPF(ultimo.DriverCPF);
          const motorista = cpfNorm ? mapCPF[cpfNorm] : null;
          const novoMotoristaId = motorista ? motorista.id : null;

          if (veiculo.motorista_id !== novoMotoristaId) {
            updates.push(db.entities.Veiculo.update(veiculo.id, { motorista_id: novoMotoristaId }));
            atualizados++;
          }
        } else {
          // Logout: limpar motorista do veículo
          if (veiculo.motorista_id) {
            updates.push(db.entities.Veiculo.update(veiculo.id, { motorista_id: null }));
            atualizados++;
          }
        }
      }

      if (updates.length) await Promise.all(updates);

      results.push({
        empresa: empresa.nome,
        atualizados,
        logs_recebidos: logs.length,
        veiculos_com_log: Object.keys(logsPorVeiculo).length,
        debug_janela: `${fmt(from)} -> ${fmt(now)}`,
      });

    } catch (e) {
      results.push({ empresa: empresa.nome, error: e.message });
    }
  }

  return Response.json({ success: true, timestamp: new Date().toISOString(), results });
});