import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// URL de produção correta conforme documentação
const PROD_URL = 'https://aapi3.autotrac-online.com.br/aticapi';
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const ACCOUNT_CODE = 10849;

function getHeaders() {
  return {
    'Authorization': `Basic ${USER}:${PASS}`,
    'Ocp-Apim-Subscription-Key': API_KEY,
    'Content-Type': 'application/json'
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const step = body.step || 'vehicles'; // 'vehicles' | 'messages'
    const vehicleCode = body.vehicleCode;

    if (step === 'vehicles') {
      // Buscar veículos ativos - sem paginação limit/offset, usa _limit conforme doc
      const url = `${PROD_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles`;
      const res = await fetch(url, { headers: getHeaders() });
      const text = await res.text();

      let data;
      try { data = JSON.parse(text); } catch { data = text; }

      return Response.json({
        step,
        url,
        status: res.status,
        headers_sent: {
          Authorization: `Basic ${USER}:${PASS}`,
          'Ocp-Apim-Subscription-Key': API_KEY ? `${API_KEY.substring(0,8)}...` : 'NOT SET'
        },
        response_type: typeof data,
        is_array: Array.isArray(data),
        count: Array.isArray(data) ? data.length : (data?.Data?.length ?? 'N/A'),
        sample: Array.isArray(data) ? data.slice(0,3) : (data?.Data?.slice(0,3) ?? data),
        raw_keys: typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : null
      });
    }

    if (step === 'messages' && vehicleCode) {
      const url = `${PROD_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles/${vehicleCode}/returnmessages`;
      const res = await fetch(url, { headers: getHeaders() });
      const text = await res.text();

      let data;
      try { data = JSON.parse(text); } catch { data = text; }

      const msgs = Array.isArray(data) ? data : (data?.Data || []);
      const macrosValidas = msgs.filter(m => m.MacroNumber !== null && m.MacroNumber !== undefined && m.MacroNumber > 0);

      return Response.json({
        step,
        url,
        status: res.status,
        total_mensagens: msgs.length,
        macros_validas: macrosValidas.length,
        sample_macros: macrosValidas.slice(0,5).map(m => ({
          MacroNumber: m.MacroNumber,
          MessageTime: m.MessageTime,
          MacroVersion: m.MacroVersion
        })),
        sample_raw: msgs.slice(0,2),
        data_keys: typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : null
      });
    }

    return Response.json({ error: 'Informe step=vehicles ou step=messages com vehicleCode' }, { status: 400 });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});