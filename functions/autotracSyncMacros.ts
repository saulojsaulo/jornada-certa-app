import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = 'https://aapi3.autotrac-online.com.br/aticapi';
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const ACCOUNT_CODE = 10849;
const MACROS_VALIDAS = [1, 2, 3, 4, 5, 6, 9, 10];

// Máximo de veículos processados por execução (para evitar timeout de 60s)
// Reduzido para 15 para garantir que não estoure o tempo limite
const MAX_VEICULOS_POR_RODADA = 15;

function getAuthHeaders() {
  return {
    'Authorization': `Basic ${USER}:${PASS}`,
    'Ocp-Apim-Subscription-Key': API_KEY,
    'Content-Type': 'application/json'
  };
}

function fmtDate(d) {
  // Formato esperado pela API: "YYYY-MM-DD HH:MM:SS"
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    try {
      const user = await base44.auth.me();
      if (user?.role !== 'admin') {
        return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
      }
    } catch {
      // Automação agendada sem usuário - OK
    }

    // Aceitar offset de veículos para processar em lotes (via automação ou chamada manual)
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const veiculoOffset = body.veiculoOffset ?? 0;
    const strategy = body.strategy || 'linear'; // 'linear' (manual/UI) ou 'smart' (automação)

    // Buscar TODOS os veículos com autotrac_id
    let veiculos = await base44.asServiceRole.entities.Veiculo.list('-created_date', 5000);
    
    // Se estratégia for 'smart', ordenar pelos que não foram sincronizados há mais tempo (null primeiro, depois datas antigas)
    if (strategy === 'smart') {
        veiculos.sort((a, b) => {
            if (!a.last_sync_macros) return -1;
            if (!b.last_sync_macros) return 1;
            return a.last_sync_macros.localeCompare(b.last_sync_macros);
        });
    }

    const veiculosComId = veiculos.filter(v => v.autotrac_id && v.ativo !== false);

    if (veiculosComId.length === 0) {
      return Response.json({ success: true, message: 'Nenhum veículo com autotrac_id. Sincronize veículos primeiro.' });
    }

    // Processar fatia de veículos
    let lote;
    let proxOffset;
    let temMais;

    if (strategy === 'smart') {
        // Na estratégia smart, pegamos sempre os primeiros (mais antigos)
        lote = veiculosComId.slice(0, MAX_VEICULOS_POR_RODADA);
        proxOffset = 0; // Irrelevante para smart
        temMais = veiculosComId.length > MAX_VEICULOS_POR_RODADA; // Sempre tem mais se a lista for maior que o lote, mas o job roda em ciclo
    } else {
        // Estratégia linear (respeita offset para varredura sequencial completa)
        lote = veiculosComId.slice(veiculoOffset, veiculoOffset + MAX_VEICULOS_POR_RODADA);
        proxOffset = veiculoOffset + MAX_VEICULOS_POR_RODADA;
        temMais = proxOffset < veiculosComId.length;
    }

    // Janela de tempo: últimas 48h (API guarda 7 dias, mas 48h é suficiente para continuidade)
    const agora = new Date();
    const inicio48h = new Date(agora.getTime() - 48 * 60 * 60 * 1000);
    const startDateStr = fmtDate(inicio48h);
    const endDateStr = fmtDate(agora);

    // Carregar macros existentes nas últimas 48h para deduplicação (chave: veiculo_id + macro + minuto)
    const macrosExistentes = await base44.asServiceRole.entities.MacroEvento.list('-created_date', 10000);
    const macrosIndex = new Set();
    for (const m of macrosExistentes) {
      if (m.data_criacao && new Date(m.data_criacao) >= inicio48h) {
        const key = `${m.veiculo_id}_${m.numero_macro}_${m.data_criacao.substring(0, 16)}`;
        macrosIndex.add(key);
      }
    }

    let totalImportadas = 0;
    let totalIgnoradas = 0;
    const erros = [];

    for (const veiculo of lote) {
      try {
        // Buscar todas as páginas de mensagens de retorno com filtro de data
        let allMensagens = [];
        let offset = 0;
        const limit = 50;

        while (true) {
          const url = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles/${veiculo.autotrac_id}/returnmessages` +
            `?startDate=${encodeURIComponent(startDateStr)}&endDate=${encodeURIComponent(endDateStr)}` +
            `&limit=${limit}&offset=${offset}`;

          const res = await fetch(url, { headers: getAuthHeaders() });

          if (!res.ok) {
            const text = await res.text();
            erros.push(`Veículo ${veiculo.autotrac_id} (${veiculo.nome_veiculo}): HTTP ${res.status} - ${text.substring(0, 100)}`);
            break;
          }

          const data = await res.json();
          // API retorna { Data: [...], Limit, Offset, IsLastPage }
          const page = data.Data || data.data || (Array.isArray(data) ? data : []);
          allMensagens = allMensagens.concat(page);

          if (data.IsLastPage === true || page.length < limit) break;
          offset += limit;

          // Segurança: max 20 páginas por veículo (1000 mensagens)
          if (offset >= limit * 20) break;

          await new Promise(r => setTimeout(r, 1000));
        }

        // Filtrar e preparar macros para inserção
        const macrosParaInserir = [];

        for (const msg of allMensagens) {
          // Campo correto conforme documentação: MacroNumber
          const numeroMacro = msg.MacroNumber;
          if (numeroMacro === null || numeroMacro === undefined || !MACROS_VALIDAS.includes(numeroMacro)) continue;

          // Campo correto conforme documentação: MessageTime
          const dataCriacao = msg.MessageTime;
          if (!dataCriacao) continue;

          const dataCriacaoISO = new Date(dataCriacao).toISOString();
          if (new Date(dataCriacaoISO) < inicio48h) continue;

          const key = `${veiculo.id}_${numeroMacro}_${dataCriacaoISO.substring(0, 16)}`;
          if (macrosIndex.has(key)) {
            totalIgnoradas++;
            continue;
          }

          macrosParaInserir.push({
            veiculo_id: veiculo.id,
            numero_macro: numeroMacro,
            data_criacao: dataCriacaoISO,
            data_jornada: dataCriacaoISO.substring(0, 10),
            excluido: false,
            editado_manualmente: false
          });

          macrosIndex.add(key);
        }

        // Calcular jornada_id baseado na Macro 1 mais próxima anterior
        const macro1s = macrosParaInserir.filter(m => m.numero_macro === 1);
        for (const m of macrosParaInserir) {
          const macro1Ref = macro1s
            .filter(m1 => m1.data_criacao <= m.data_criacao)
            .sort((a, b) => b.data_criacao.localeCompare(a.data_criacao))[0];
          m.jornada_id = `${veiculo.id}-${(macro1Ref || m).data_criacao.substring(0, 10)}`;
          if (macro1Ref) m.data_jornada = macro1Ref.data_criacao.substring(0, 10);
        }

        if (macrosParaInserir.length > 0) {
          await base44.asServiceRole.entities.MacroEvento.bulkCreate(macrosParaInserir);
          totalImportadas += macrosParaInserir.length;
        }

        // Atualizar timestamp da última sincronização do veículo
        await base44.asServiceRole.entities.Veiculo.update(veiculo.id, { 
            last_sync_macros: new Date().toISOString() 
        });

        // Delay entre veículos para respeitar rate limit
        await new Promise(r => setTimeout(r, 1200));

      } catch (err) {
        erros.push(`Veículo ${veiculo.nome_veiculo}: ${err.message}`);
      }
    }

    return Response.json({
      success: true,
      message: `Lote ${veiculoOffset}-${veiculoOffset + lote.length} de ${veiculosComId.length} veículos processados.`,
      veiculos_neste_lote: lote.length,
      veiculos_total: veiculosComId.length,
      macros_importadas: totalImportadas,
      macros_ignoradas_duplicatas: totalIgnoradas,
      proximo_offset: temMais ? proxOffset : null,
      concluido: !temMais,
      erros: erros.length > 0 ? erros : undefined
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});