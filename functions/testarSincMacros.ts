import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const db = base44.asServiceRole;

  // Teste 1: buscar empresas
  const empresas = await db.entities.Empresa.filter({ ativa: true }, '-created_date', 10);
  
  return Response.json({ ok: true, empresas_count: empresas.length });
});