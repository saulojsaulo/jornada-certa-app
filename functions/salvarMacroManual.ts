import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

function getDataJornada(dataCriacao) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(dataCriacao));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    const body = await req.json();
    const { action, macro_id, veiculo_id, company_id, numero_macro, data_criacao } = body;

    if (action === 'toggle') {
      if (!macro_id) {
        return Response.json({ error: 'Parâmetro obrigatório: macro_id' }, { status: 400 });
      }

      const { data: atual, error: atualError } = await supabase
        .from('macro_eventos')
        .select('*')
        .eq('id', macro_id)
        .single();

      if (atualError) {
        return Response.json({ error: atualError.message }, { status: 500 });
      }

      const { data, error } = await supabase
        .from('macro_eventos')
        .update({
          excluido: !atual.excluido,
          editado_manualmente: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', macro_id)
        .select('*')
        .single();

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }

      return Response.json({ macro: data });
    }

    if (action === 'update') {
      if (!macro_id || !veiculo_id || !company_id || !numero_macro || !data_criacao) {
        return Response.json({ error: 'Parâmetros obrigatórios: macro_id, veiculo_id, company_id, numero_macro, data_criacao' }, { status: 400 });
      }

      const data_jornada = getDataJornada(data_criacao);
      const jornada_id = `${veiculo_id}-${data_jornada}`;

      const { data, error } = await supabase
        .from('macro_eventos')
        .update({
          numero_macro,
          data_criacao,
          data_jornada,
          jornada_id,
          editado_manualmente: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', macro_id)
        .select('*')
        .single();

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }

      return Response.json({ macro: data });
    }

    if (action === 'create') {
      if (!veiculo_id || !company_id || !numero_macro || !data_criacao) {
        return Response.json({ error: 'Parâmetros obrigatórios: veiculo_id, company_id, numero_macro, data_criacao' }, { status: 400 });
      }

      const data_jornada = getDataJornada(data_criacao);
      const jornada_id = `${veiculo_id}-${data_jornada}`;

      const { data, error } = await supabase
        .from('macro_eventos')
        .insert([{
          veiculo_id,
          company_id,
          numero_macro,
          data_criacao,
          data_jornada,
          jornada_id,
          excluido: false,
          editado_manualmente: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: user.email,
        }])
        .select('*')
        .single();

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }

      return Response.json({ macro: data });
    }

    return Response.json({ error: 'Ação inválida' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});