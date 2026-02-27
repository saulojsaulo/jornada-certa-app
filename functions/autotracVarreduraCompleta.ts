import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");

// Cocal Cereais = Code 10849 (ignorar Cedro Transportes Code 11007)
const ACCOUNT_CODE = 10849;
const MACROS_VALIDAS = [1, 2, 3, 4, 5, 6, 9, 10];

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

    const resultado = {
      veiculos: { criados: 0, atualizados: 0, total: 0 },
      macros: { importadas: 0, ignoradas: 0, veiculos_processados: 0 },
      erros: []
    };

    // ===== ETAPA 1: SINCRONIZAR VEÍCULOS =====
    // API retorna no máximo 10 por página, paginar até buscar todos
    const PAGE_SIZE = 10;
    const vehicles = [];
    let vOffset = 0;

    while (true) {
      const vehiclesRes = await fetch(`${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles?limit=${PAGE_SIZE}&offset=${vOffset}`, {
        headers: getAuthHeaders()
      });

      if (!vehiclesRes.ok) {
        const text = await vehiclesRes.text();
        throw new Error(`Falha ao buscar veículos: ${vehiclesRes.status} - ${text}`);
      }

      const vehiclesData = await vehiclesRes.json();
      const page = Array.isArray(vehiclesData)
        ? vehiclesData
        : (vehiclesData.Data || vehiclesData.data || vehiclesData.vehicles || []);

      vehicles.push(...page);

      if (vehiclesData.IsLastPage === true || page.length < PAGE_SIZE) break;
      vOffset += PAGE_SIZE;
      if (vOffset >= PAGE_SIZE * 300) break; // segurança: max 3000 veículos

      // Respeitar rate limit
      await new Promise(r => setTimeout(r, 700));
    }

    resultado.veiculos.total = vehicles.length;

    const veiculosExistentes = await base44.asServiceRole.entities.Veiculo.list();
    const existentesMap = {};
    for (const v of veiculosExistentes) {
      if (v.autotrac_id) existentesMap[String(v.autotrac_id)] = v;
    }

    for (const vehicle of vehicles) {
      const autotracId = String(vehicle.Code || vehicle.code || '');
      const nomeVeiculo = vehicle.Name || vehicle.name || `Veículo ${autotracId}`;
      const placa = vehicle.LicensePlate || vehicle.licensePlate || vehicle.plate || '';
      const numeroFrota = vehicle.Address || vehicle.address || vehicle.TripName || '';

      if (!autotracId) continue;

      if (existentesMap[autotracId]) {
        await base44.asServiceRole.entities.Veiculo.update(existentesMap[autotracId].id, {
          ativo: true,
          placa: placa || existentesMap[autotracId].placa,
        });
        resultado.veiculos.atualizados++;
      } else {
        await base44.asServiceRole.entities.Veiculo.create({
          nome_veiculo: nomeVeiculo,
          placa: placa,
          numero_frota: numeroFrota,
          autotrac_id: autotracId,
          ativo: true
        });
        resultado.veiculos.criados++;
      }
      // Delay para evitar rate limit do Base44 SDK ao processar muitos veículos
      await new Promise(r => setTimeout(r, 50));
    }

    // ===== ETAPA 2: SINCRONIZAR MACROS =====
    // Recarregar veículos após sincronização
    const veiculosAtualizados = await base44.asServiceRole.entities.Veiculo.list();
    const veiculosComId = veiculosAtualizados.filter(v => v.autotrac_id && v.ativo !== false);

    if (veiculosComId.length > 0) {
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

      resultado.macros.veiculos_processados = veiculosComId.length;

      for (const veiculo of veiculosComId) {
      try {
        // Buscar todas as páginas de mensagens
        let offset = 0;
        const limit = 50;
        let isLastPage = false;
        const mensagens = [];

        while (!isLastPage) {
          const url = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles/${veiculo.autotrac_id}/returnmessages?limit=${limit}&offset=${offset}`;
          const msgRes = await fetch(url, { headers: getAuthHeaders() });

          if (!msgRes.ok) {
            resultado.erros.push(`Veículo ${veiculo.autotrac_id}: HTTP ${msgRes.status}`);
            break;
          }

          const msgData = await msgRes.json();
          const page = Array.isArray(msgData)
            ? msgData
            : (msgData.Data || msgData.data || msgData.messages || []);

          mensagens.push(...page);
          isLastPage = msgData.IsLastPage !== false && page.length < limit;
          offset += limit;

          // Segurança: parar após 10 páginas
          if (offset >= limit * 10) break;
        }

        if (mensagens.length === 0 && resultado.erros.some(e => e.includes(veiculo.autotrac_id))) {
          continue;
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
              resultado.macros.ignoradas++;
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
            resultado.macros.importadas += macrosParaInserir.length;
          }

        } catch (err) {
          resultado.erros.push(`Veículo ${veiculo.nome_veiculo}: ${err.message}`);
        }
      }
    }

    return Response.json({
      success: true,
      message: `Varredura completa concluída! Veículos: ${resultado.veiculos.criados} criados, ${resultado.veiculos.atualizados} atualizados. Macros: ${resultado.macros.importadas} importadas.`,
      resultado,
      erros: resultado.erros.length > 0 ? resultado.erros : undefined
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});