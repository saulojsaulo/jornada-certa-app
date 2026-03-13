import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { company_id, date_inicio, date_fim } = await req.json();
    if (!company_id || !date_inicio || !date_fim) {
      return Response.json({ error: 'Parâmetros obrigatórios: company_id, date_inicio, date_fim' }, { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    const { data, error } = await supabase
      .from('macro_eventos')
      .select('*')
      .eq('company_id', company_id)
      .gte('data_jornada', date_inicio)
      .lte('data_jornada', date_fim)
      .order('data_criacao', { ascending: false });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ macros: data || [] });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});