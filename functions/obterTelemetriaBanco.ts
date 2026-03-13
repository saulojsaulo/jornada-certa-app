import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { company_id, vehicleCode, veiculo_id, date } = await req.json();
    if ((!vehicleCode && !veiculo_id) || !date) {
      return Response.json({ pontos: [], distancia_km: null, total_raw: 0 });
    }

    const db = base44.asServiceRole;
    let resolvedCompanyId = company_id;
    let resolvedVehicleCode = vehicleCode;
    let resolvedVeiculoId = veiculo_id;

    if (!resolvedCompanyId || !resolvedVehicleCode || !resolvedVeiculoId) {
      if (resolvedVeiculoId) {
        const veiculos = await db.entities.Veiculo.filter({ id: resolvedVeiculoId }, '-created_date', 1);
        const veiculo = veiculos?.[0];
        resolvedCompanyId = resolvedCompanyId || veiculo?.company_id || null;
        resolvedVehicleCode = resolvedVehicleCode || veiculo?.numero_frota || null;
      } else if (resolvedVehicleCode) {
        const veiculos = await db.entities.Veiculo.filter({ numero_frota: resolvedVehicleCode }, '-created_date', 1);
        const veiculo = veiculos?.[0];
        resolvedCompanyId = resolvedCompanyId || veiculo?.company_id || null;
        resolvedVeiculoId = resolvedVeiculoId || veiculo?.id || null;
      }
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    let query = supabase
      .from('telemetria_veiculos')
      .select('*')
      .eq('data_jornada', date);

    if (resolvedVeiculoId) {
      query = query.eq('veiculo_id', resolvedVeiculoId);
    } else if (resolvedCompanyId && resolvedVehicleCode) {
      query = query.eq('company_id', resolvedCompanyId).eq('vehicle_code', resolvedVehicleCode);
    } else {
      return Response.json({ pontos: [], distancia_km: null, total_raw: 0 });
    }

    const { data, error } = await query.maybeSingle();

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