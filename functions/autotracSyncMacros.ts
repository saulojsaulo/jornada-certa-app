import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");

const MACROS_VALIDAS = [1, 2, 3, 4, 5, 6, 9, 10];
const ACCOUNT_CODE = 10849;

function getAuthHeaders() {
  return {
    'Authorization': `Basic ${USER}:${PASS}`,
    'Ocp-Apim-Subscription-Key': API_KEY,
    'Content-Type': 'application/json'
  };
}

function parseMacroNumber(msg) {
  const raw = msg.MacroNumber ?? msg.macro ?? msg.macroCode ?? msg.macro_code ?? msg.code ??
              msg.messageCode ?? msg.message_code ?? msg.returnCode ?? msg.return_code ??
              msg.messageType ?? msg.message_type ?? msg.type;
  if (raw === undefined || raw === null) return null;
  const num = parseInt(String(raw), 10);
  return isNaN(num) ? null : num;
}

function parseDataCriacao(msg) {
  const raw = msg.MessageTime ?? msg.date ?? msg.datetime ?? msg.createdAt ?? msg.created_at ??
              msg.timestamp ?? msg.sentAt ?? msg.sent_at ?? msg.dateTime ?? msg.dateCreated;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Busca TODOS os registros de uma entidade paginando
async function listAll(entity) {
  const all = [];
  let skip = 0;
  const limit = 500;
  while (true) {
    const page = await entity.list(undefined, limit, skip);
    all.push(...page);
    if (page.length < limit) break;
    skip += limit;
  }
  return all;
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

    // Buscar TODOS os veículos cadastrados no sistema
    const veiculos = await listAll(base44.asServiceRole.entities.Veiculo);
    const veiculosComId = veiculos.filter(v => v.autotrac_id && v.ativo !== false);

    if (veiculosComId.length === 0) {
      return Response.json({ success: true, message: 'Nenhum veículo com autotrac_id encontrado. Sincronize os veículos primeiro.' });
    }

    // Buscar TODAS as macros existentes nas últimas 48h para deduplicação
    const agora = new Date();
    const limite48h = new Date(agora.getTime() - 48 * 60 * 60 * 1000);

    const macrosExistentes = await listAll(base44.asServiceRole.entities.MacroEvento);
    const macrosIndex = new Set();
    for (const m of macrosExistentes) {
      if (m.data_criacao && new Date(m.data_criacao) >= limite48h) {
        const key = `${m.veiculo_id}_${m.numero_macro}_${m.data_criacao.substring(0, 16)}`;
        macrosIndex.add(key);
      }
    }

    let totalImportadas = 0;
    let totalIgnoradas = 0;
    const erros = [];

    for (const veiculo of veiculosComId) {
      try {
        const url = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles/${veiculo.autotrac_id}/returnmessages`;
        const msgRes = await fetch(url, { headers: getAuthHeaders() });

        if (!msgRes.ok) {
          erros.push(`Veículo ${veiculo.autotrac_id}: HTTP ${msgRes.status}`);
          continue;
        }

        const msgData = await msgRes.json();
        const mensagens = Array.isArray(msgData)
          ? msgData
          : (msgData.Data || msgData.data || msgData.messages || []);

        const macrosParaInserir = [];

        for (const msg of mensagens) {
          const numeroMacro = parseMacroNumber(msg);
          if (numeroMacro === null || !MACROS_VALIDAS.includes(numeroMacro)) continue;

          const dataCriacao = parseDataCriacao(msg);
          if (!dataCriacao) continue;

          if (new Date(dataCriacao) < limite48h) continue;

          const key = `${veiculo.id}_${numeroMacro}_${dataCriacao.substring(0, 16)}`;
          if (macrosIndex.has(key)) {
            totalIgnoradas++;
            continue;
          }

          macrosParaInserir.push({
            veiculo_id: veiculo.id,
            numero_macro: numeroMacro,
            data_criacao: dataCriacao,
            data_jornada: dataCriacao.substring(0, 10),
            excluido: false,
            editado_manualmente: false
          });

          macrosIndex.add(key);
        }

        // Calcular jornada_id
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

        // Delay para respeitar rate limit da Autotrac
        await new Promise(r => setTimeout(r, 500));

      } catch (err) {
        erros.push(`Veículo ${veiculo.nome_veiculo}: ${err.message}`);
      }
    }

    return Response.json({
      success: true,
      message: `Sincronização de macros concluída.`,
      veiculos_processados: veiculosComId.length,
      macros_importadas: totalImportadas,
      macros_ignoradas_duplicatas: totalIgnoradas,
      erros: erros.length > 0 ? erros : undefined
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});