import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// URL de produção correta conforme documentação
const PROD_URL = 'https://aapi3.autotrac-online.com.br/aticapi';
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const ACCOUNT_CODE = 10849;
const MACROS_VALIDAS = [1, 2, 3, 4, 5, 6, 9, 10];
const MAX_VEICULOS_POR_RODADA = 15;

function getHeaders() {
  return {
    'Authorization': `Basic ${USER}:${PASS}`,
    'Ocp-Apim-Subscription-Key': API_KEY,
    'Content-Type': 'application/json'
  };
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

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const veiculoOffset = body.veiculoOffset ?? 0;

    // Carregar todos os veículos com autotrac_id
    const todosVeiculos = await base44.asServiceRole.entities.Veiculo.list('-created_date', 5000);
    const veiculosComId = todosVeiculos.filter(v => v.autotrac_id && v.ativo !== false);

    const lote = veiculosComId.slice(veiculoOffset, veiculoOffset + MAX_VEICULOS_POR_RODADA);

    if (lote.length === 0) {
      return Response.json({
        success: true,
        message: 'Nenhum veículo para processar.',
        concluido: true,
        proximo_offset: null
      });
    }

    // Índice de macros existentes para deduplicação
    const macrosExistentes = await base44.asServiceRole.entities.MacroEvento.filter(
      { editado_manualmente: false },
      '-data_criacao',
      10000
    ).catch(() => base44.asServiceRole.entities.MacroEvento.list('-data_criacao', 10000));

    const macrosIndex = new Set();
    for (const m of macrosExistentes) {
      if (m.data_criacao) {
        const key = `${m.veiculo_id}_${m.numero_macro}_${m.data_criacao.substring(0, 16)}`;
        macrosIndex.add(key);
      }
    }

    const agora = new Date();
    const limite48h = new Date(agora.getTime() - 48 * 60 * 60 * 1000);

    let macrosImportadas = 0;
    let macrosIgnoradas = 0;
    const erros = [];

    for (const veiculo of lote) {
      try {
        let offset = 0;
        const limit = 50;
        let isLastPage = false;
        const mensagens = [];

        // Paginar mensagens de retorno deste veículo
        while (!isLastPage) {
          const url = `${PROD_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles/${veiculo.autotrac_id}/returnmessages?limit=${limit}&offset=${offset}`;
          const res = await fetch(url, { headers: getHeaders() });

          if (!res.ok) {
            erros.push(`Veículo ${veiculo.autotrac_id} (${veiculo.nome_veiculo}): HTTP ${res.status}`);
            break;
          }

          const data = await res.json();
          // Resposta estruturada: { Data: [...], Limit, Offset, IsLastPage }
          const page = data.Data || (Array.isArray(data) ? data : []);
          mensagens.push(...page);

          isLastPage = data.IsLastPage === true || page.length < limit;
          offset += limit;
          if (offset >= limit * 20) break; // segurança: max 20 páginas = 1000 msgs
          
          await new Promise(r => setTimeout(r, 100));
        }

        const macrosParaInserir = [];

        for (const msg of mensagens) {
          const numeroMacro = msg.MacroNumber;
          if (numeroMacro === null || numeroMacro === undefined || !MACROS_VALIDAS.includes(numeroMacro)) continue;

          const dataCriacao = msg.MessageTime;
          if (!dataCriacao) continue;

          const dataObj = new Date(dataCriacao);
          if (isNaN(dataObj.getTime()) || dataObj < limite48h) continue;

          const dataISO = dataObj.toISOString();
          const key = `${veiculo.id}_${numeroMacro}_${dataISO.substring(0, 16)}`;
          if (macrosIndex.has(key)) {
            macrosIgnoradas++;
            continue;
          }

          macrosParaInserir.push({
            veiculo_id: veiculo.id,
            numero_macro: numeroMacro,
            data_criacao: dataISO,
            data_jornada: dataISO.substring(0, 10),
            excluido: false,
            editado_manualmente: false
          });

          macrosIndex.add(key);
        }

        // Calcular jornada_id baseado na Macro 1 mais recente antes de cada macro
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
          macrosImportadas += macrosParaInserir.length;

          // Atualizar timestamp de última sincronização
          await base44.asServiceRole.entities.Veiculo.update(veiculo.id, {
            last_sync_macros: agora.toISOString()
          });
        }

        await new Promise(r => setTimeout(r, 150));

      } catch (err) {
        erros.push(`Veículo ${veiculo.nome_veiculo}: ${err.message}`);
      }
    }

    const proximo = veiculoOffset + MAX_VEICULOS_POR_RODADA;
    const concluido = proximo >= veiculosComId.length;

    return Response.json({
      success: true,
      message: `Lote ${veiculoOffset}-${veiculoOffset + lote.length} de ${veiculosComId.length} veículos processados.`,
      veiculos_neste_lote: lote.length,
      veiculos_total: veiculosComId.length,
      macros_importadas: macrosImportadas,
      macros_ignoradas_duplicatas: macrosIgnoradas,
      proximo_offset: concluido ? null : proximo,
      concluido,
      erros: erros.length > 0 ? erros : undefined
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});