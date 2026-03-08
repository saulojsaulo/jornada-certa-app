import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL") || 'https://aapi3.autotrac-online.com.br/aticapi/v1';
const ACCOUNT = Deno.env.get("AUTOTRAC_ACCOUNT");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");

async function fetchAutotrac(url, usuario, senha, apiKey) {
  const response = await fetch(url, {
    headers: {
      'Authorization': `Basic ${usuario}:${senha}`,
      'Ocp-Apim-Subscription-Key': apiKey,
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
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = base44.asServiceRole;
    
    // Buscar empresa
    const empresas = await db.entities.Empresa.list();
    if (!empresas || empresas.length === 0) {
      return Response.json({ error: 'Nenhuma empresa encontrada' }, { status: 404 });
    }
    
    const empresa = empresas[0];
    const cfg = empresa?.api_config || {};
    const usuario = cfg?.autotrac_usuario || USER;
    const senha = cfg?.autotrac_senha || PASS;
    const apiKey = cfg?.autotrac_api_key || API_KEY;
    const accountNum = String(cfg?.autotrac_account || ACCOUNT || '');

    if (!usuario || !senha || !apiKey) {
      return Response.json({ error: 'Credenciais incompletas' }, { status: 400 });
    }

    // Buscar account code
    const accountsRaw = await fetchAutotrac(`${BASE_URL}/accounts?_limit=500`, usuario, senha, apiKey);
    const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
    const contas = accountNum ? accountList.filter(a => String(a.Number) === accountNum) : accountList;
    
    if (!contas.length) {
      return Response.json({ error: `Conta ${accountNum} não encontrada` }, { status: 404 });
    }
    
    const accountCode = contas[0].Code;
    
    // Buscar todos os veículos da empresa
    const veiculos = await db.entities.Veiculo.filter({ company_id: empresa.id });
    
    // Coletar motoristas logados
    const motoristasLogados = new Map(); // CPF -> { nome, cpf, telefone }
    
    for (const veiculo of veiculos) {
      try {
        const driverLogsUrl = `${BASE_URL}/accounts/${accountCode}/vehicles/${veiculo.numero_frota}/driverlogs`;
        const driverLogsData = await fetchAutotrac(driverLogsUrl, usuario, senha, apiKey);
        
        if (!driverLogsData.Data || driverLogsData.Data.length === 0) {
          continue;
        }

        // Encontrar o motorista logado (mais recente sem LogoutTime)
        const ultimoLog = driverLogsData.Data.sort((a, b) => {
          const timeA = new Date(a.LoginTime || a.LogoutTime || 0).getTime();
          const timeB = new Date(b.LoginTime || b.LogoutTime || 0).getTime();
          return timeB - timeA;
        })[0];
        
        if (ultimoLog && !ultimoLog.LogoutTime && ultimoLog.DriverCPF) {
          // Motorista está logado
          if (!motoristasLogados.has(ultimoLog.DriverCPF)) {
            motoristasLogados.set(ultimoLog.DriverCPF, {
              nome: ultimoLog.DriverName || `Motorista ${ultimoLog.DriverCPF}`,
              cpf: ultimoLog.DriverCPF,
              telefone: ''
            });
          }
        }
      } catch (err) {
        console.error(`Erro ao buscar motorista do veículo ${veiculo.numero_frota}: ${err.message}`);
      }
    }

    // Excluir todos os motoristas da empresa
    const motoristasExistentes = await db.entities.Motorista.filter({ company_id: empresa.id });
    for (const m of motoristasExistentes) {
      await db.entities.Motorista.delete(m.id);
    }

    // Inserir novos motoristas
    const novosMotoristasData = Array.from(motoristasLogados.values()).map(m => ({
      nome: m.nome,
      cpf: m.cpf,
      telefone: m.telefone,
      ativo: true,
      company_id: empresa.id
    }));

    let inseridos = 0;
    if (novosMotoristasData.length > 0) {
      await db.entities.Motorista.bulkCreate(novosMotoristasData);
      inseridos = novosMotoristasData.length;
    }

    return Response.json({
      success: true,
      motoristasSubstituidos: inseridos,
      motoristasLogados: motoristasLogados.size
    });
  } catch (error) {
    console.error(`Erro geral: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});