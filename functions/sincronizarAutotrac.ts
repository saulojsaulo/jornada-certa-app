import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

/**
 * Busca macros da Autotrac para todas as empresas configuradas com a provedora "autotrac"
 * e salva os MacroEventos no banco, respeitando registros editados manualmente.
 * 
 * Pode ser chamada manualmente ou via automação agendada.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Permite chamada tanto autenticada quanto via automação (service role)
    let isScheduled = false;
    try {
      const user = await base44.auth.me();
      if (user?.role !== 'admin') {
        return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
      }
    } catch {
      // Se não há usuário autenticado, assume que é chamada via automação (service role)
      isScheduled = true;
    }

    const serviceBase44 = base44.asServiceRole;

    // 1. Buscar todas as empresas com Autotrac configurada
    const empresas = await serviceBase44.entities.Empresa.filter({
      provedora_rastreamento: 'autotrac',
      ativa: true,
    });

    if (!empresas || empresas.length === 0) {
      return Response.json({ message: 'Nenhuma empresa com Autotrac configurada.', synced: 0 });
    }

    const results = [];

    for (const empresa of empresas) {
      const cfg = empresa.api_config || {};

      // Credenciais: prioriza os campos da empresa, com fallback para secrets globais
      const usuario = cfg.autotrac_usuario || Deno.env.get('AUTOTRAC_USER');
      const senha = cfg.autotrac_senha || Deno.env.get('AUTOTRAC_PASS');
      const apiKey = cfg.autotrac_api_key || Deno.env.get('AUTOTRAC_API_KEY');
      const account = cfg.autotrac_account || Deno.env.get('AUTOTRAC_ACCOUNT');
      const baseUrl = cfg.autotrac_base_url || Deno.env.get('AUTOTRAC_BASE_URL') || 'https://api.autotrac.com.br';

      if (!usuario || !senha || !apiKey) {
        results.push({ empresa: empresa.nome, error: 'Credenciais incompletas.' });
        continue;
      }

      // Buscar veículos da empresa para mapear placa/frota -> veiculo_id
      const veiculos = await serviceBase44.entities.Veiculo.filter({ company_id: empresa.id });
      const veiculoMap = {}; // placa -> veiculo
      for (const v of veiculos) {
        if (v.placa) veiculoMap[v.placa.toUpperCase().trim()] = v;
        if (v.numero_frota) veiculoMap[v.numero_frota.toUpperCase().trim()] = v;
      }

      // Buscar macros da Autotrac com paginação
      const basicAuth = btoa(`${usuario}:${senha}`);
      let page = 1;
      const pageSize = 100;
      let totalFetched = 0;
      let savedCount = 0;
      let errorCount = 0;
      let hasMore = true;

      while (hasMore) {
        // Endpoint padrão da Autotrac para busca de macros/eventos
        // Ajuste o path conforme a documentação da sua conta Autotrac
        const url = `${baseUrl}/api/v1/macros?account=${encodeURIComponent(account)}&page=${page}&pageSize=${pageSize}`;

        const response = await fetch(url, {
          headers: {
            'Authorization': `Basic ${basicAuth}`,
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        });

        if (!response.ok) {
          const errText = await response.text();
          results.push({ empresa: empresa.nome, error: `Autotrac API error (${response.status}): ${errText}` });
          hasMore = false;
          break;
        }

        const data = await response.json();

        // Suporta tanto array direto quanto { data: [...], total, ... }
        const registros = Array.isArray(data) ? data : (data.data || data.records || data.items || []);

        if (!registros || registros.length === 0) {
          hasMore = false;
          break;
        }

        totalFetched += registros.length;

        for (const reg of registros) {
          // Mapeamento dos campos da Autotrac
          // Ajuste os campos conforme a documentação real da sua Autotrac
          const placa = (reg.placa || reg.plate || reg.licensePlate || '').toUpperCase().trim();
          const frota = (reg.frota || reg.fleetNumber || reg.fleet || '').toUpperCase().trim();
          const numeroMacro = reg.macro || reg.macroNumber || reg.numero_macro;
          const dataCriacao = reg.dataHora || reg.dateTime || reg.timestamp || reg.data_criacao;

          if (!numeroMacro || !dataCriacao) continue;

          // Encontrar veículo pelo identificador
          const veiculo = veiculoMap[placa] || veiculoMap[frota];
          if (!veiculo) continue; // Veículo não cadastrado no sistema

          // Construir jornada_id: veiculo_id-data_macro1 (usa data do evento)
          const dataEvento = new Date(dataCriacao);
          const dataStr = dataEvento.toISOString().split('T')[0];
          const jornadaId = `${veiculo.id}-${dataStr}`;

          // Verificar se já existe este evento (mesmo veiculo + macro + data próxima)
          const existing = await serviceBase44.entities.MacroEvento.filter({
            veiculo_id: veiculo.id,
            numero_macro: numeroMacro,
            jornada_id: jornadaId,
          });

          // Verificar se já existe um registro muito próximo em horário (tolerância de 2 min)
          const tol = 2 * 60 * 1000; // 2 minutos em ms
          const jaExiste = existing.some(e => {
            const diff = Math.abs(new Date(e.data_criacao) - dataEvento);
            return diff < tol;
          });

          if (jaExiste) continue;

          // Verificar se foi editado manualmente (não sobrescrever)
          const editadoManualmente = existing.some(e => e.editado_manualmente);
          if (editadoManualmente) continue;

          // Criar o MacroEvento
          try {
            await serviceBase44.entities.MacroEvento.create({
              veiculo_id: veiculo.id,
              numero_macro: Number(numeroMacro),
              data_criacao: new Date(dataCriacao).toISOString(),
              jornada_id: jornadaId,
              data_jornada: dataStr,
              excluido: false,
              editado_manualmente: false,
              company_id: empresa.id,
            });
            savedCount++;
          } catch (e) {
            errorCount++;
          }
        }

        // Verificar se há mais páginas
        if (Array.isArray(data)) {
          hasMore = registros.length === pageSize;
        } else {
          const total = data.total || data.totalCount || data.count;
          hasMore = total ? (page * pageSize < total) : (registros.length === pageSize);
        }

        page++;
      }

      results.push({
        empresa: empresa.nome,
        fetched: totalFetched,
        saved: savedCount,
        errors: errorCount,
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