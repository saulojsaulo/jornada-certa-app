Deno.serve(async (_req) => {
  return Response.json({ ok: true, message: 'hello' });
});