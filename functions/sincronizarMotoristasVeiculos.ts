import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL") || 'https://aapi3.autotrac-online.com.br/aticapi/v1';
const ACCOUNT = Deno.env.get("AUTOTRAC_ACCOUNT");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");

async function fetchAutotrac(url) {
  const response = await fetch(url, {
    headers: {
      'Authorization': `Basic ${USER}:${PASS}`,
      'Ocp-Apim-Subscription-Key': API_KEY,
      'Content-Type': 'application/json',
      'User-Agent': 'PostmanRuntime/7.37.0',
      'Cache-Control': 'no-cache',
    },
    timeout: 20000
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[AUTOTRAC] ${response.status} - ${errorText.substring(0, 200)}`);
    throw new Error(`Autotrac API error: ${response.status}`);
  }
  
  return response.json();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const companyId = user.company_id;
    
    // Buscar empresa para pegar credenciais
    const empresa = await base44.entities.Empresa.filter({ id: companyId });
    if (!empresa || empresa.length === 0) {
      return Response.json({ error: 'Empresa não encontrada' }, { status: 404 });
    }
    
    const cfg = empresa[0].api_config || {};
    const usuario = cfg.autotrac_usuario || USER;
    const senha = cfg.autotrac_senha || PASS;
    const apiKey = cfg.autotrac_api_key || API_KEY;
    const accountNum = String(cfg.autotrac_account || ACCOUNT || '');

    if (!usuario || !senha || !apiKey) {
      return Response.json({ error: 'Credenciais incompletas' }, { status: 400 });
    }

    // Buscar account code
    const accountsRaw = await fetchAutotrac(`${BASE_URL}/accounts?_limit=500`);
    const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
    const contas = accountNum ? accountList.filter(a => String(a.Number) === accountNum) : accountList;
    
    if (!contas.length) {
      return Response.json({ error: `Conta ${accountNum} não encontrada` }, { status: 404 });
    }
    
    const accountCode = contas[0].Code;
    
    // Buscar todos os veículos da empresa
    const veiculos = await base44.entities.Veiculo.filter({ company_id: companyId });
    
    // Buscar todos os motoristas da empresa
    const motoristas = await base44.entities.Motorista.filter({ company_id: companyId });
    const motoristaPorCPF = {};
    motoristas.forEach(m => {
      if (m.cpf) motoristaPorCPF[m.cpf] = m;
    });

    let atualizacoes = 0;
    const erros = [];

    // Para cada veículo, buscar driverlogs
    for (const veiculo of veiculos) {
      try {
        // Buscar driverlogs usando account code correto
        const driverLogsUrl = `${BASE_URL}/accounts/${accountCode}/vehicles/${veiculo.numero_frota}/driverlogs`;
        console.log(`[SYNC] Buscando driverlogs: ${driverLogsUrl}`);
        
        const driverLogsData = await fetchAutotrac(driverLogsUrl);
        
        if (!driverLogsData.Data || driverLogsData.Data.length === 0) {
          // Nenhum log, limpar motorista se houver
          if (veiculo.motorista_id) {
            await base44.entities.Veiculo.update(veiculo.id, { motorista_id: null });
            atualizacoes++;
          }
          continue;
        }

        // O último log (índice 0 é o mais recente quando ordenado por data DESC)
        const ultimoLog = driverLogsData.Data.sort((a, b) => {
          const timeA = new Date(a.LoginTime || a.LogoutTime || 0).getTime();
          const timeB = new Date(b.LoginTime || b.LogoutTime || 0).getTime();
          return timeB - timeA;
        })[0];
        
        // Se há LogoutTime, o motorista saiu - limpar
        if (ultimoLog.LogoutTime) {
          if (veiculo.motorista_id) {
            await base44.entities.Veiculo.update(veiculo.id, { motorista_id: null });
            atualizacoes++;
          }
        } else {
          // Motorista está logado - vinculá-lo
          if (ultimoLog.DriverCPF) {
            const motorista = motoristaPorCPF[ultimoLog.DriverCPF];
            const motorista_id = motorista?.id || null;
            
            // Atualizar somente se mudou
            if (veiculo.motorista_id !== motorista_id) {
              await base44.entities.Veiculo.update(veiculo.id, { motorista_id });
              atualizacoes++;
            }
          }
        }
      } catch (err) {
        erros.push(`Veículo ${veiculo.numero_frota}: ${err.message}`);
      }
    }

    return Response.json({
      success: true,
      atualizacoes,
      erros: erros.length > 0 ? erros : null
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});