import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const ACCOUNT = Deno.env.get("AUTOTRAC_ACCOUNT");

// Macros numéricas que nos interessam
const MACROS_VALIDAS = [1, 2, 3, 4, 5, 6, 9, 10];

async function getAutotracToken() {
  const credentials = btoa(`${USER}:${PASS}`);
  const res = await fetch(`${BASE_URL}/v1/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'x-api-key': API_KEY,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Autotrac auth failed: ${res.status} - ${text}`);
  }

  const data = await res.json();
  return data.access_token || data.token || data.accessToken || data;
}

function parseMacroNumber(msg) {
  // Tenta extrair número de macro de campos comuns
  const raw = msg.macro || msg.macroCode || msg.macro_code || msg.code || msg.messageCode || msg.message_code;
  if (raw === undefined || raw === null) return null;
  const num = parseInt(String(raw), 10);
  if (isNaN(num)) return null;
  return num;
}

function parseDataCriacao(msg) {
  const raw = msg.date || msg.datetime || msg.createdAt || msg.created_at || msg.timestamp || msg.sentAt || msg.sent_at;
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Autenticação - aceitar chamadas de automação ou de admin
    try {
      const user = await base44.auth.me();
      if (user?.role !== 'admin') {
        return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
      }
    } catch {
      // Chamada via automação agendada (sem usuário autenticado) - OK
    }

    // 1. Obter token Autotrac
    const token = await getAutotracToken();

    // 2. Buscar veículos cadastrados no sistema com autotrac_id
    const veiculos = await base44.asServiceRole.entities.Veiculo.list();
    const veiculosComId = veiculos.filter(v => v.autotrac_id && v.ativo !== false);

    if (veiculosComId.length === 0) {
      return Response.json({ success: true, message: 'Nenhum veículo com autotrac_id encontrado. Sincronize os veículos primeiro.' });
    }

    // 3. Buscar macros existentes nas últimas 48h para evitar duplicatas
    const agora = new Date();
    const limite48h = new Date(agora.getTime() - 48 * 60 * 60 * 1000);

    const macrosExistentes = await base44.asServiceRole.entities.MacroEvento.list();
    // Indexar macros existentes por chave única: veiculo_id + numero_macro + data_criacao (truncado ao minuto)
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

    // 4. Para cada veículo, buscar mensagens de retorno
    for (const veiculo of veiculosComId) {
      try {
        const url = `${BASE_URL}/v1/accounts/${ACCOUNT}/vehicles/${veiculo.autotrac_id}/returnmessages`;
        const msgRes = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'x-api-key': API_KEY,
            'Content-Type': 'application/json'
          }
        });

        if (!msgRes.ok) {
          erros.push(`Veículo ${veiculo.autotrac_id}: HTTP ${msgRes.status}`);
          continue;
        }

        const msgData = await msgRes.json();
        const mensagens = Array.isArray(msgData) ? msgData : (msgData.messages || msgData.data || []);

        const macrosParaInserir = [];

        for (const msg of mensagens) {
          const numeroMacro = parseMacroNumber(msg);
          if (numeroMacro === null || !MACROS_VALIDAS.includes(numeroMacro)) continue;

          const dataCriacao = parseDataCriacao(msg);
          if (!dataCriacao) continue;

          // Filtrar apenas últimas 48h
          if (new Date(dataCriacao) < limite48h) continue;

          // Verificar duplicata
          const key = `${veiculo.id}_${numeroMacro}_${dataCriacao.substring(0, 16)}`;
          if (macrosIndex.has(key)) {
            totalIgnoradas++;
            continue;
          }

          // Calcular jornada_id e data_jornada (baseado na Macro 1 do agrupamento)
          const dataJornada = dataCriacao.substring(0, 10);

          macrosParaInserir.push({
            veiculo_id: veiculo.id,
            numero_macro: numeroMacro,
            data_criacao: dataCriacao,
            data_jornada: dataJornada,
            excluido: false,
            editado_manualmente: false
          });

          macrosIndex.add(key);
        }

        // Inserir em lote
        if (macrosParaInserir.length > 0) {
          // Processar jornada_id para cada macro
          // Agrupa por data e busca macro 1 para compor jornada_id
          const macro1s = macrosParaInserir.filter(m => m.numero_macro === 1);
          for (const m of macrosParaInserir) {
            // Encontrar macro 1 mais próxima anterior
            const macro1Ref = macro1s
              .filter(m1 => m1.data_criacao <= m.data_criacao)
              .sort((a, b) => b.data_criacao.localeCompare(a.data_criacao))[0];
            
            if (macro1Ref) {
              m.jornada_id = `${veiculo.id}-${macro1Ref.data_criacao.substring(0, 10)}`;
              m.data_jornada = macro1Ref.data_criacao.substring(0, 10);
            } else {
              m.jornada_id = `${veiculo.id}-${m.data_criacao.substring(0, 10)}`;
            }
          }

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
      erros: erros.length > 0 ? erros : undefined
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});