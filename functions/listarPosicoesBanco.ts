import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { company_id, vehicleCodes = [], date } = await req.json();
    if (!company_id || !date || !vehicleCodes.length) {
      return Response.json({ positions: {} });
    }

    const start = new Date(`${date}T00:00:00-03:00`).toISOString();
    const end = new Date(`${date}T23:59:59-03:00`).toISOString();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    const { data, error } = await supabase
      .from('posicoes_veiculos')
      .select('*')
      .eq('company_id', company_id)
      .in('vehicle_code', vehicleCodes)
      .gte('data_posicao', start)
      .lte('data_posicao', end)
      .order('data_posicao', { ascending: false });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    const positions = {};
    for (const row of data || []) {
      if (!positions[row.vehicle_code]) {
        positions[row.vehicle_code] = {
          lat: row.latitude,
          lng: row.longitude,
          address: row.endereco,
          time: row.data_posicao,
        };
      }
    }

    return Response.json({ positions });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});