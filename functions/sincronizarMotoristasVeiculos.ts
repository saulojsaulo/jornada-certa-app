import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const RAW_BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL") || 'https://aapi3.autotrac-online.com.br/aticapi/v1';
const BASE_URL = RAW_BASE_URL.endsWith('/v1') ? RAW_BASE_URL : `${RAW_BASE_URL.replace(/\/$/, '')}/v1`;
const BASE_URL_WAPI = 'https://wapi.autotrac-online.com.br/aticapi/v1';
const ACCOUNT = Deno.env.get("AUTOTRAC_ACCOUNT");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");

function normalizarCPF(cpf) {
  if (!cpf) return '';
  return String(cpf).replace(/\D/g, '');
}

function extrairNomeMotorista(log) {
  return String(
    log.DriverName ||
    log.Driver ||
    log.Name ||
    log.UserName ||
    log.LoginName ||
    'Motorista sem nome'
  ).trim();
}

function fmtAutotracDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function fetchAutotrac(url, usuario, senha, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const response = await fetch(url, {
    headers: {
      'Authorization': `Basic ${usuario}:${senha}`,
      'Ocp-Apim-Subscription-Key': apiKey,
      'Content-Type': 'application/json',
      'User-Agent': 'PostmanRuntime/7.37.0',
      'Cache-Control': 'no-cache',
    },
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[AUTOTRAC] ${response.status} - ${errorText.substring(0, 200)}`);
    throw new Error(`Autotrac API error: ${response.status}`);
  }

  return response.json();
}

async function fetchDriverLogs(accountCode, vehicleCode, from, now, usuario, senha, apiKey) {
  const qs = `startDate=${encodeURIComponent(fmtAutotracDate(from))}&endDate=${encodeURIComponent(fmtAutotracDate(now))}&_limit=10`;
  const candidates = [
    `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/driverlogs?${qs}`,
    `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/driverlog?${qs}`,
    `${BASE_URL_WAPI}/accounts/${accountCode}/vehicles/${vehicleCode}/driverlogs?${qs}`,
    `${BASE_URL_WAPI}/accounts/${accountCode}/vehicles/${vehicleCode}/driverlog?${qs}`,
  ];

  let lastError = null;
  for (const url of candidates) {
    try {
      return await fetchAutotrac(url, usuario, senha, apiKey);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Driverlogs não encontrado');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = base44.asServiceRole;
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    const empresas = await db.entities.Empresa.filter({ provedora_rastreamento: 'autotrac', ativa: true }, '-created_date', 100);
    if (!empresas?.length) {
      return Response.json({ error: 'Nenhuma empresa encontrada' }, { status: 404 });
    }

    const resultados = [];

    for (const empresa of empresas) {
      const cfg = empresa.api_config || {};
      const usuario = cfg.autotrac_usuario || USER;
      const senha = cfg.autotrac_senha || PASS;
      const apiKey = cfg.autotrac_api_key || API_KEY;
      const accountNum = String(cfg.autotrac_account || ACCOUNT || '');

      if (!usuario || !senha || !apiKey) {
        resultados.push({ empresa: empresa.nome, error: 'Credenciais incompletas' });
        continue;
      }

      try {
        const accountsRaw = await fetchAutotrac(`${BASE_URL}/accounts?_limit=500`, usuario, senha, apiKey);
        const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
        const contas = accountNum ? accountList.filter(a => String(a.Number) === accountNum) : accountList;
        if (!contas.length) {
          resultados.push({ empresa: empresa.nome, error: `Conta ${accountNum} não encontrada` });
          continue;
        }

        const accountCode = contas[0].Code;
        const veiculos = await db.entities.Veiculo.filter({ company_id: empresa.id, ativo: true }, '-created_date', 500);
        const motoristasEntity = await db.entities.Motorista.filter({ company_id: empresa.id }, '-created_date', 1000);
        const motoristaPorCPF = {};
        motoristasEntity.forEach(m => {
          const cpfNorm = normalizarCPF(m.cpf);
          if (cpfNorm) motoristaPorCPF[cpfNorm] = m;
        });

        const { data: motoristasSupabase = [] } = await supabase
          .from('motoristas')
          .select('id, nome, cpf, telefone, ativo, company_id')
          .eq('company_id', empresa.id);

        const motoristasSupabasePorCPF = {};
        motoristasSupabase.forEach(m => {
          const cpfNorm = normalizarCPF(m.cpf);
          if (cpfNorm) motoristasSupabasePorCPF[cpfNorm] = m;
        });

        let veiculosAtualizados = 0;
        let motoristasInseridos = 0;
        let motoristasAtualizados = 0;
        const erros = [];
        const now = new Date();
        const from = new Date(now.getTime() - 48 * 60 * 60 * 1000);

        for (const veiculo of veiculos) {
          if (!veiculo.numero_frota) continue;

          try {
            const driverLogsData = await fetchDriverLogs(accountCode, veiculo.numero_frota, from, now, usuario, senha, apiKey);
            const logs = Array.isArray(driverLogsData?.Data) ? driverLogsData.Data : [];

            if (!logs.length) {
              if (veiculo.motorista_id) {
                await db.entities.Veiculo.update(veiculo.id, { motorista_id: null });
                veiculosAtualizados++;
              }
              continue;
            }

            const ultimoLog = [...logs].sort((a, b) => {
              const timeA = new Date(a.LoginTime || a.LogoutTime || 0).getTime();
              const timeB = new Date(b.LoginTime || b.LogoutTime || 0).getTime();
              return timeB - timeA;
            })[0];

            if (ultimoLog.LogoutTime) {
              if (veiculo.motorista_id) {
                await db.entities.Veiculo.update(veiculo.id, { motorista_id: null });
                veiculosAtualizados++;
              }
              continue;
            }

            const cpfNorm = normalizarCPF(ultimoLog.DriverCPF || ultimoLog.CPF || ultimoLog.DriverDocument);
            if (!cpfNorm) continue;

            const nomeMotorista = extrairNomeMotorista(ultimoLog);
            const payloadSupabase = {
              nome: nomeMotorista,
              cpf: cpfNorm,
              telefone: null,
              ativo: true,
              company_id: empresa.id,
              updated_at: new Date().toISOString(),
            };

            const existenteSupabase = motoristasSupabasePorCPF[cpfNorm];
            if (existenteSupabase) {
              const { error } = await supabase
                .from('motoristas')
                .update(payloadSupabase)
                .eq('id', existenteSupabase.id);
              if (!error) motoristasAtualizados++;
            } else {
              const { data, error } = await supabase
                .from('motoristas')
                .insert([{ ...payloadSupabase, created_at: new Date().toISOString(), created_by: user.email }])
                .select('id, nome, cpf, telefone, ativo, company_id')
                .single();
              if (!error && data) {
                motoristasSupabasePorCPF[cpfNorm] = data;
                motoristasInseridos++;
              }
            }

            const motoristaEntity = motoristaPorCPF[cpfNorm] || null;
            const motoristaId = motoristaEntity?.id || null;
            if (veiculo.motorista_id !== motoristaId) {
              await db.entities.Veiculo.update(veiculo.id, { motorista_id: motoristaId });
              veiculosAtualizados++;
            }
          } catch (err) {
            erros.push(`Veículo ${veiculo.numero_frota}: ${err.message}`);
          }
        }

        resultados.push({
          empresa: empresa.nome,
          veiculos_atualizados: veiculosAtualizados,
          motoristas_inseridos_supabase: motoristasInseridos,
          motoristas_atualizados_supabase: motoristasAtualizados,
          erros: erros.length ? erros : null,
        });
      } catch (error) {
        resultados.push({ empresa: empresa.nome, error: error.message });
      }
    }

    return Response.json({ success: true, resultados });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});