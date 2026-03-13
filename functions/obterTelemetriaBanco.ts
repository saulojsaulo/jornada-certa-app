import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { company_id, vehicleCode, date } = await req.json();
    if (!vehicleCode || !date) {
      return Response.json({ error: 'Parâmetros obrigatórios: vehicleCode, date' }, { status: 400 });
    }

    const db = base44.asServiceRole;
    let resolvedCompanyId = company_id;

    if (!resolvedCompanyId) {
      const veiculos = await db.entities.Veiculo.filter({ numero_frota: vehicleCode }, '-created_date', 1);
      resolvedCompanyId = veiculos?.[0]?.company_id || null;
    }

    if (!resolvedCompanyId) {
      return Response.json({ error: 'company_id não encontrado para este veículo' }, { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    const { data, error } = await supabase
      .from('telemetria_veiculos')
      .select('*')
      .eq('company_id', resolvedCompanyId)
      .eq('vehicle_code', vehicleCode)
      .eq('data_jornada', date)
      .maybeSingle();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({
      pontos: data?.pontos || [],
      distancia_km: data?.distancia_km ?? null,
      total_raw: data?.total_raw ?? 0,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});