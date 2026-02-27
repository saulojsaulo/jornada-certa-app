import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    const veiculos = await base44.asServiceRole.entities.Veiculo.list('-created_date', 5000);
    return Response.json({ count: veiculos.length });
});