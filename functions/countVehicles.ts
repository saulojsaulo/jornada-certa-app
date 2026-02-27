import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    const veiculos = await base44.asServiceRole.entities.Veiculo.list('-created_date', 5000);
    const comId = veiculos.filter(v => v.autotrac_id).length;
    return Response.json({ total: veiculos.length, comId });
});