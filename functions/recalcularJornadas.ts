import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Buscar todos os veículos e macros
    const veiculos = await base44.asServiceRole.entities.Veiculo.list(undefined, 500);
    const macros = await base44.asServiceRole.entities.MacroEvento.list(undefined, 10000);

    // Agrupar macros por veículo
    const macrosPorVeiculo = {};
    macros.forEach(m => {
      if (!macrosPorVeiculo[m.veiculo_id]) {
        macrosPorVeiculo[m.veiculo_id] = [];
      }
      macrosPorVeiculo[m.veiculo_id].push(m);
    });

    // Atualizar jornadas para cada veículo
    let atualizadas = 0;
    const macrosParaAtualizar = [];

    Object.keys(macrosPorVeiculo).forEach(veiculoId => {
      const macrosVeiculo = macrosPorVeiculo[veiculoId].sort((a, b) => 
        new Date(a.data_criacao) - new Date(b.data_criacao)
      );

      let jornadaAtual = null;

      macrosVeiculo.forEach(m => {
        const dataJornada = new Date(m.data_criacao).toISOString().split('T')[0];

        if (m.numero_macro === 1) {
          jornadaAtual = {
            jornadaId: `${veiculoId}-${dataJornada}-${new Date(m.data_criacao).getTime()}`,
            dataJornada: dataJornada
          };
          
          if (m.jornada_id !== jornadaAtual.jornadaId) {
            m.jornada_id = jornadaAtual.jornadaId;
            m.data_jornada = jornadaAtual.dataJornada;
            macrosParaAtualizar.push({
              id: m.id,
              jornada_id: m.jornada_id,
              data_jornada: m.data_jornada
            });
            atualizadas++;
          }
        } else if (jornadaAtual) {
          if (m.jornada_id !== jornadaAtual.jornadaId) {
            m.jornada_id = jornadaAtual.jornadaId;
            m.data_jornada = jornadaAtual.dataJornada;
            macrosParaAtualizar.push({
              id: m.id,
              jornada_id: m.jornada_id,
              data_jornada: m.data_jornada
            });
            atualizadas++;
          }
        }
      });
    });

    // Atualizar em batch
    if (macrosParaAtualizar.length > 0) {
      for (const macro of macrosParaAtualizar) {
        await base44.asServiceRole.entities.MacroEvento.update(macro.id, {
          jornada_id: macro.jornada_id,
          data_jornada: macro.data_jornada
        });
      }
    }

    return Response.json({
      success: true,
      macros_atualizadas: atualizadas
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});