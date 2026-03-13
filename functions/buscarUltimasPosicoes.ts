import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const BASE_URL = 'https://aapi3.autotrac-online.com.br/aticapi/v1';

function autotracHeaders(usuario, senha, apiKey) {
  return {
    'Authorization': `Basic ${usuario}:${senha}`,
    'Ocp-Apim-Subscription-Key': apiKey,
    'Content-Type': 'application/json',
  };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  );

  const body = await req.json().catch(() => ({}));
  const { vehicleCodes, company_id } = body;

  // Modo manual frontend: buscar posições específicas
  if (vehicleCodes?.length && company_id) {
    try {
      const { data: empresa } = await supabase
        .from('Empresa')
        .select('*')
        .eq('id', company_id)
        .single();

      if (!empresa) {
        return Response.json({ error: 'Empresa não encontrada' }, { status: 404 });
      }

      const cfg = empresa.api_config || {};
      const usuario = cfg.autotrac_usuario || Deno.env.get('AUTOTRAC_USER');
      const senha = cfg.autotrac_senha || Deno.env.get('AUTOTRAC_PASS');
      const apiKey = cfg.autotrac_api_key || Deno.env.get('AUTOTRAC_API_KEY');
      const accountNum = String(cfg.autotrac_account || Deno.env.get('AUTOTRAC_ACCOUNT') || '');

      if (!usuario || !senha || !apiKey) {
        return Response.json({ error: 'Credenciais Autotrac não configuradas' }, { status: 500 });
      }

      const headers = autotracHeaders(usuario, senha, apiKey);
      const now = new Date();
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

      // Buscar account code
      const accountsRes = await fetch(`${BASE_URL}/accounts?_limit=500`, { headers });
      const accountsRaw = await accountsRes.json();
      const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
      const conta = accountNum ? accountList.find(a => String(a.Number) === accountNum) : accountList[0];
      
      if (!conta) {
        return Response.json({ error: 'Conta Autotrac não encontrada' }, { status: 404 });
      }

      const accountCode = conta.Code;
      const positions = {};

      // Buscar posições em lotes de 8
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
            
            if (!res.ok) { 
              positions[vehicleCode] = null; 
              return; 
            }
            
            const data = await res.json();
            const items = Array.isArray(data) ? data : (data.Data || data.data || []);
            
            if (!items.length) { 
              positions[vehicleCode] = null; 
              return; 
            }
            
            const sorted = items.sort((a, b) =>
              new Date(b.PositionTime || b.ReceivedTime) - new Date(a.PositionTime || a.ReceivedTime)
            );
            const last = sorted[0];
            
            positions[vehicleCode] = {
              address: last.Landmark || null,
              time: last.PositionTime || last.ReceivedTime || null,
              lat: last.Latitude,
              lng: last.Longitude,
            };
          } catch (e) {
            console.error(`Erro ao buscar posição para ${vehicleCode}: ${e.message}`);
            positions[vehicleCode] = null;
          }
        }));
      }

      return Response.json({ positions });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Modo automação: processar todas empresas ativas
  const { data: empresas } = await supabase
    .from('Empresa')
    .select('*')
    .eq('provedora_rastreamento', 'autotrac')
    .eq('ativa', true)
    .limit(100);

  if (!empresas?.length) {
    return Response.json({ message: 'Nenhuma empresa Autotrac ativa encontrada.' });
  }

  const resultsPorEmpresa = [];
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  const hoje = now.toISOString().split('T')[0];

  for (const empresa of empresas) {
    try {
      const cfg = empresa.api_config || {};
      const usuario = cfg.autotrac_usuario || Deno.env.get('AUTOTRAC_USER');
      const senha = cfg.autotrac_senha || Deno.env.get('AUTOTRAC_PASS');
      const apiKey = cfg.autotrac_api_key || Deno.env.get('AUTOTRAC_API_KEY');
      const accountNum = String(cfg.autotrac_account || Deno.env.get('AUTOTRAC_ACCOUNT') || '');

      if (!usuario || !senha || !apiKey) {
        resultsPorEmpresa.push({ empresa: empresa.nome, error: 'Credenciais incompletas' });
        continue;
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
        if (!conta) {
          resultsPorEmpresa.push({ empresa: empresa.nome, error: 'Conta não encontrada' });
          continue;
        }
        accountCode = conta.Code;
      } catch (e) {
        clearTimeout(timeout);
        resultsPorEmpresa.push({ empresa: empresa.nome, error: e.message });
        continue;
      }

      // Buscar veículos via Supabase
      const { data: veiculos } = await supabase
        .from('Veiculo')
        .select('*')
        .eq('company_id', empresa.id)
        .eq('ativo', true)
        .limit(500);

      if (!veiculos?.length) {
        resultsPorEmpresa.push({ 
          empresa: empresa.nome, 
          error: 'Nenhum veículo encontrado' 
        });
        continue;
      }

      const vehicleCodes = veiculos
        .map(v => v.numero_frota)
        .filter(Boolean);

      if (!vehicleCodes.length) {
        resultsPorEmpresa.push({ empresa: empresa.nome, error: 'Nenhum número de frota válido' });
        continue;
      }

      const results = {};
      const chunks = [];
      for (let i = 0; i < vehicleCodes.length; i += 5) {
        chunks.push(vehicleCodes.slice(i, i + 5));
      }

      for (const chunk of chunks) {
        await Promise.all(chunk.map(async (vehicleCode) => {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 10000);
            const url = `${BASE_URL}/accounts/${accountCode}/vehicles/${vehicleCode}/positions?startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(now))}&_limit=50`;
            const res = await fetch(url, { headers, signal: ctrl.signal });
            clearTimeout(t);
            if (!res.ok) { 
              if (res.status === 422) return;
              results[vehicleCode] = null; 
              return; 
            }
            const data = await res.json();
            const items = Array.isArray(data) ? data : (data.Data || data.data || []);
            if (!items.length) { results[vehicleCode] = null; return; }
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
          } catch (e) {
            console.error(`Erro ao buscar posição para ${vehicleCode}: ${e.message}`);
            results[vehicleCode] = null;
          }
        }));
        await new Promise(r => setTimeout(r, 500));
      }

      // Salvar no Supabase em lote
      const posicoesParaSalvar = [];
      for (const [vehicleCode, posicao] of Object.entries(results)) {
        if (!posicao || !posicao.lat || !posicao.lng) continue;
        const posDate = posicao.time ? new Date(posicao.time).toISOString().split('T')[0] : hoje;
        if (posDate !== hoje) continue;
        
        posicoesParaSalvar.push({
          vehicle_code: vehicleCode,
          data_posicao: posicao.time || now.toISOString(),
          latitude: posicao.lat,
          longitude: posicao.lng,
          endereco: posicao.address || null,
          company_id: empresa.id,
        });
      }

      let persistidas = 0;
      if (posicoesParaSalvar.length > 0) {
        for (let i = 0; i < posicoesParaSalvar.length; i += 20) {
          const batch = posicoesParaSalvar.slice(i, i + 20);
          const { error } = await supabase
            .from('PosicaoVeiculo')
            .insert(batch);
          
          if (!error) {
            persistidas += batch.length;
          } else {
            console.error(`Erro ao persistir lote: ${error.message}`);
          }
          
          if (i + 20 < posicoesParaSalvar.length) {
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }

      resultsPorEmpresa.push({
        empresa: empresa.nome,
        veiculos_processados: vehicleCodes.length,
        posicoes_persistidas: persistidas,
      });

    } catch (e) {
      resultsPorEmpresa.push({ empresa: empresa.nome, error: e.message });
    }
  }

  return Response.json({ 
    success: true, 
    timestamp: now.toISOString(), 
    results: resultsPorEmpresa,
    positions: {}
  });
});