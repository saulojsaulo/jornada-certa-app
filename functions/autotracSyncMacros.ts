import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const ACCOUNT = Deno.env.get("AUTOTRAC_ACCOUNT");

const MACROS_VALIDAS = [1, 2, 3, 4, 5, 6, 9, 10];

function getAuthHeaders() {
  const credentials = btoa(`${USER}:${PASS}`);
  return {
    'Authorization': `Basic ${credentials}`,
    'x-api-key': API_KEY,
    'Content-Type': 'application/json'
  };
}

function parseMacroNumber(msg) {
  // Campos comuns onde a macro pode estar
  const raw = msg.macro ?? msg.macroCode ?? msg.macro_code ?? msg.code ?? 
              msg.messageCode ?? msg.message_code ?? msg.returnCode ?? msg.return_code ??
              msg.messageType ?? msg.message_type ?? msg.type;
  if (raw === undefined || raw === null) return null;
  const num = parseInt(String(raw), 10);
  return isNaN(num) ? null : num;
}

function parseDataCriacao(msg) {
  const raw = msg.date ?? msg.datetime ?? msg.createdAt ?? msg.created_at ?? 
              msg.timestamp ?? msg.sentAt ?? msg.sent_at ?? msg.dateTime ?? msg.dateCreated;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString();
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

    // Buscar veículos cadastrados no sistema com autotrac_id
    const veiculos = await base44.asServiceRole.entities.Veiculo.list();
    const veiculosComId = veiculos.filter(v => v.autotrac_id && v.ativo !== false);

    if (veiculosComId.length === 0) {
      return Response.json({ success: true, message: 'Nenhum veículo com autotrac_id encontrado. Sincronize os veículos primeiro.' });
    }

    // Buscar macros existentes para evitar duplicatas
    const agora = new Date();
    const limite48h = new Date(agora.getTime() - 48 * 60 * 60 * 1000);

    const macrosExistentes = await base44.asServiceRole.entities.MacroEvento.list();
    const macrosIndex = new Set();
    for (const m of macrosExistentes) {
      if (m.data_criacao) {
        const key = `${m.veiculo_id}_${m.numero_macro}_${m.data_criacao.substring(0, 16)}`;
        macrosIndex.add(key);
      }
    }

    let totalImportadas = 0;
    let totalIgnoradas = 0;
    const erros = [];
    let rawSample = null; // Para debug

    for (const veiculo of veiculosComId) {
      try {
        const url = `${BASE_URL}/v1/accounts/${ACCOUNT}/vehicles/${veiculo.autotrac_id}/returnmessages`;
        const msgRes = await fetch(url, { headers: getAuthHeaders() });

        if (!msgRes.ok) {
          erros.push(`Veículo ${veiculo.autotrac_id}: HTTP ${msgRes.status}`);
          continue;
        }

        const msgData = await msgRes.json();
        const mensagens = Array.isArray(msgData) ? msgData : (msgData.messages || msgData.data || []);

        // Guardar amostra para debug
        if (!rawSample && mensagens.length > 0) {
          rawSample = mensagens[0];
        }

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

        // Calcular jornada_id para cada macro inserida
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
      raw_sample: rawSample, // Para debug da estrutura
      erros: erros.length > 0 ? erros : undefined
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});