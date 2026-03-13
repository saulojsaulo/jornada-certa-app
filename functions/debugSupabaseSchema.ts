Deno.serve(async () => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: 'application/openapi+json',
      },
    });

    const data = await res.json();
    const definitions = Object.keys(data?.definitions || {});
    const paths = Object.keys(data?.paths || {});

    return Response.json({ definitions, paths: paths.slice(0, 50) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});