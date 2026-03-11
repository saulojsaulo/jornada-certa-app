import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { createClient } from 'npm:@supabase/supabase-js'; // Nova importação para Supabase

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

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const { vehicleCodes, company_id } = body;

  if (!vehicleCodes || !vehicleCodes.length) {
    return Response.json({ error: 'vehicleCodes é obrigatório' }, { status: 400 });
  }

  // Inicialização do cliente Supabase
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(JSON.stringify({ error: 'Credenciais do Supabase não configuradas.' }), { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });
  // Fim da inicialização do Supabase

  let usuario, senha, apiKey, accountNum;
  if (company_id) {
    // Usando Supabase para buscar dados da empresa
    const { data: empresas, error: empresaError } = await supabase
      .from('Empresa') // Usando o nome da entidade, que o Supabase deve ter transformado para 'empresa' ou 'Empresa'
      .select('*')
      .eq('id', company_id);

    if (empresaError) {
      console.error(`Erro ao buscar empresa no Supabase: ${empresaError.message}`);
      return Response.json({ error: 'Erro ao buscar dados da empresa.' }, { status: 500 });
    }
    
    const empresa = empresas?.[0]; // Usar optional chaining
    const cfg = empresa?.api_config || {};
    usuario = cfg.autotrac_usuario || Deno.env.get('AUTOTRAC_USER');
    senha = cfg.autotrac_senha || Deno.env.get('AUTOTRAC_PASS');
    apiKey = cfg.autotrac_api_key || Deno.env.get('AUTOTRAC_API_KEY');
    accountNum = String(cfg.autotrac_account || Deno.env.get('AUTOTRAC_ACCOUNT') || '');
  } else {
    usuario = Deno.env.get('AUTOTRAC_USER');
    senha = Deno.env.get('AUTOTRAC_PASS');
    apiKey = Deno.env.get('AUTOTRAC_API_KEY');
    accountNum = String(Deno.env.get('AUTOTRAC_ACCOUNT') || '');
  }

  if (!usuario || !senha || !apiKey) {
    return Response.json({ error: 'Credenciais Autotrac não configuradas' }, { status: 500 });
  }

  const headers = autotracHeaders(usuario, senha, apiKey);

  // Buscar account code
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  let accountCode;
  try {
    const accountsRes = await fetch(`${BASE_URL}/accounts?_limit=500`, { headers, signal: controller.signal });
    clearTimeout(timeout);
    const accountsRaw = await accountsRes.json();
    const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
    const conta = accountNum
      ? accountList.find(a => String(a.Number) === accountNum)
      : accountList[0];
    if (!conta) return Response.json({ error: 'Conta não encontrada' }, { status: 404 });
    accountCode = conta.Code;
  } catch (e) {
    clearTimeout(timeout);
    return Response.json({ error: e.message }, { status: 500 });
  }

  const results = {};
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

  const chunks = [];
  for (let i = 0; i < vehicleCodes.length; i += 8) {
    chunks.push(vehicleCodes.slice(i, i + 8));
  }

  for (const chunk of chunks) {
    await Promise.all(chunk.map(async (vehicleCode) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 12000);
        const url = `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/positions?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=50`;
        const res = await fetch(url, { headers, signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) { results[vehicleCode] = null; return; }
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.Data || data.data || []);
        if (!items.length) { results[vehicleCode] = null; return; }
        // Pegar o mais recente
        const sorted = items.sort((a, b) =>
          new Date(b.PositionTime || b.ReceivedTime) - new Date(a.PositionTime || a.ReceivedTime)
        );
        const last = sorted[0];
        const posicao = {
          address: last.Landmark || null,
          time: last.PositionTime || last.ReceivedTime || null,
          lat: last.Latitude,
          lng: last.Longitude,
        };
        results[vehicleCode] = posicao;
      } catch (e) { // Captura o erro aqui para logar
        console.error(`Erro ao buscar posição para ${vehicleCode}: ${e.message}`);
        results[vehicleCode] = null;
      }
    }));
  }

  // Persistir posições no banco de forma sequencial para não saturar rate limit
  const hoje = now.toISOString().split('T')[0];
  for (const [vehicleCode, posicao] of Object.entries(results)) {
    if (!posicao || !posicao.lat || !posicao.lng) continue;
    const posDate = posicao.time ? new Date(posicao.time).toISOString().split('T')[0] : hoje;
    // Só persiste posições de hoje (para não criar duplicatas de dias anteriores)
    if (posDate !== hoje) continue;
    try {
      // Usando Supabase para criar o registro de posição
      const { error: insertError } = await supabase
        .from('PosicaoVeiculo') // Usando o nome da entidade, que o Supabase deve ter transformado para 'posicao_veiculo' ou 'PosicaoVeiculo'
        .insert({
          vehicle_code: vehicleCode,
          data_posicao: posicao.time || now.toISOString(),
          latitude: posicao.lat,
          longitude: posicao.lng,
          endereco: posicao.address || null,
          company_id: company_id, // company_id pode ser null se não fornecido
        });

      if (insertError) {
        console.error(`Erro ao inserir PosicaoVeiculo no Supabase: ${insertError.message}`);
        // Decida como tratar o erro, se necessário
      }

    } catch (e) { 
        console.error(`Erro ao persistir posição para ${vehicleCode}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 150)); // delay entre writes
  }

  return Response.json({ positions: results });
});