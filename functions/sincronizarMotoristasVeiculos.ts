import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const RAW_BASE_URL = Deno.env.get('AUTOTRAC_BASE_URL') || 'https://aapi3.autotrac-online.com.br/aticapi/v1';
const BASE_URL = RAW_BASE_URL.endsWith('/v1') ? RAW_BASE_URL : `${RAW_BASE_URL.replace(/\/$/, '')}/v1`;
const ACCOUNT = Deno.env.get('AUTOTRAC_ACCOUNT');
const USER = Deno.env.get('AUTOTRAC_USER');
const PASS = Deno.env.get('AUTOTRAC_PASS');
const API_KEY = Deno.env.get('AUTOTRAC_API_KEY');

function autotracHeaders(usuario, senha, apiKey) {
  return {
    Authorization: `Basic ${usuario}:${senha}`,
    'Ocp-Apim-Subscription-Key': apiKey,
    'Content-Type': 'application/json',
    'User-Agent': 'PostmanRuntime/7.37.0',
    'Cache-Control': 'no-cache',
  };
}

function normalizarCPF(cpf) {
  if (!cpf) return '';
  return String(cpf).replace(/\D/g, '');
}

function normalizarNomeVeiculo(nome) {
  if (!nome) return '';
  return String(nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function extrairNomeMotorista(item) {
  return String(item.DriverName || item.Driver || item.Name || 'Motorista sem nome').trim();
}

function fmtAutotracDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function hasActiveLogin(log) {
  if (!log?.LoginTime) return false;
  if (!log.LogoutTime) return true;
  const logout = new Date(log.LogoutTime).getTime();
  return !logout || logout <= 0;
}

async function fetchAutotrac(url, headers) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const response = await fetch(url, { headers, signal: controller.signal });
  clearTimeout(timeout);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Autotrac API error: ${response.status} ${errorText.substring(0, 200)}`);
  }

  return response.json();
}

async function fetchDriverLogs(accountCode, vehicleCode, from, now, headers) {
  const qs = `startDate=${encodeURIComponent(fmtAutotracDate(from))}&endDate=${encodeURIComponent(fmtAutotracDate(now))}&_limit=20`;
  const url = `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/driverlogs?${qs}`;
  return fetchAutotrac(url, headers);
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
        const headers = autotracHeaders(usuario, senha, apiKey);
        const accountsRaw = await fetchAutotrac(`${BASE_URL}/accounts?_limit=500`, headers);
        const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
        const conta = accountNum ? accountList.find(a => String(a.Number) === accountNum) : accountList[0];
        if (!conta) {
          resultados.push({ empresa: empresa.nome, error: `Conta ${accountNum} não encontrada` });
          continue;
        }

        const accountCode = conta.Code;
        const veiculos = await db.entities.Veiculo.filter({ company_id: empresa.id, ativo: true }, '-created_date', 500);
        const motoristasEntity = await db.entities.Motorista.filter({ company_id: empresa.id }, '-created_date', 1000);

        const veiculoPorNome = {};
        veiculos.forEach(v => {
          veiculoPorNome[normalizarNomeVeiculo(v.nome_veiculo)] = v;
        });

        const motoristaEntityPorCPF = {};
        motoristasEntity.forEach(m => {
          const cpf = normalizarCPF(m.cpf);
          if (cpf) motoristaEntityPorCPF[cpf] = m;
        });

        const { data: motoristasSupabase = [] } = await supabase
          .from('motoristas')
          .select('id, nome, cpf, telefone, ativo, company_id')
          .eq('company_id', empresa.id);

        const motoristaSupabasePorCPF = {};
        motoristasSupabase.forEach(m => {
          const cpf = normalizarCPF(m.cpf);
          if (cpf) motoristaSupabasePorCPF[cpf] = m;
        });

        const driverStatusRaw = await fetchAutotrac(`${BASE_URL}/driverstatus?_limit=500`, headers);
        const driverStatuses = Array.isArray(driverStatusRaw) ? driverStatusRaw : (driverStatusRaw.Data || []);
        const now = new Date();
        const from = new Date(now.getTime() - 12 * 60 * 60 * 1000);

        let motoristasInseridosSupabase = 0;
        let motoristasAtualizadosSupabase = 0;
        let motoristasCriadosEntity = 0;
        let veiculosAtualizados = 0;
        const erros = [];
        const veiculosComMotorista = new Set();

        for (const status of driverStatuses) {
          const nomeMotorista = extrairNomeMotorista(status);
          const nomeVeiculo = normalizarNomeVeiculo(status.VehicleName);
          if (!nomeMotorista || !nomeVeiculo) continue;

          const veiculo = veiculoPorNome[nomeVeiculo];
          if (!veiculo?.numero_frota) continue;

          try {
            const logsRaw = await fetchDriverLogs(accountCode, veiculo.numero_frota, from, now, headers);
            const logs = Array.isArray(logsRaw) ? logsRaw : (logsRaw.Data || []);
            const ultimoLog = [...logs].sort((a, b) => new Date(b.LoginTime || 0).getTime() - new Date(a.LoginTime || 0).getTime())[0];
            if (!ultimoLog || !hasActiveLogin(ultimoLog)) continue;

            const cpfNorm = normalizarCPF(ultimoLog.DriverCPF || ultimoLog.CPF || ultimoLog.DriverDocument);
            if (!cpfNorm) continue;

            const payloadSupabase = {
              nome: extrairNomeMotorista(ultimoLog),
              cpf: cpfNorm,
              telefone: null,
              ativo: true,
              company_id: empresa.id,
              updated_at: new Date().toISOString(),
            };

            const existenteSupabase = motoristaSupabasePorCPF[cpfNorm];
            if (existenteSupabase) {
              const { error } = await supabase.from('motoristas').update(payloadSupabase).eq('id', existenteSupabase.id);
              if (!error) motoristasAtualizadosSupabase++;
            } else {
              const { data, error } = await supabase
                .from('motoristas')
                .insert([{ ...payloadSupabase, created_at: new Date().toISOString(), created_by: user.email }])
                .select('id, nome, cpf, telefone, ativo, company_id')
                .single();
              if (!error && data) {
                motoristaSupabasePorCPF[cpfNorm] = data;
                motoristasInseridosSupabase++;
              }
            }

            let motoristaEntity = motoristaEntityPorCPF[cpfNorm] || null;
            if (!motoristaEntity) {
              motoristaEntity = await db.entities.Motorista.create({
                nome: payloadSupabase.nome,
                cpf: payloadSupabase.cpf,
                telefone: null,
                ativo: true,
                company_id: empresa.id,
              });
              motoristaEntityPorCPF[cpfNorm] = motoristaEntity;
              motoristasCriadosEntity++;
            }

            veiculosComMotorista.add(veiculo.id);
            if (veiculo.motorista_id !== motoristaEntity.id) {
              await db.entities.Veiculo.update(veiculo.id, { motorista_id: motoristaEntity.id });
              veiculosAtualizados++;
            }
          } catch (error) {
            erros.push(`Veículo ${veiculo.numero_frota}: ${error.message}`);
          }
        }

        for (const veiculo of veiculos) {
          if (!veiculosComMotorista.has(veiculo.id) && veiculo.motorista_id) {
            await db.entities.Veiculo.update(veiculo.id, { motorista_id: null });
            veiculosAtualizados++;
          }
        }

        resultados.push({
          empresa: empresa.nome,
          driverstatus_lidos: driverStatuses.length,
          motoristas_inseridos_supabase: motoristasInseridosSupabase,
          motoristas_atualizados_supabase: motoristasAtualizadosSupabase,
          motoristas_criados_entity: motoristasCriadosEntity,
          veiculos_atualizados: veiculosAtualizados,
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