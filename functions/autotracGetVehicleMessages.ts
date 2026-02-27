import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PROD_URL = 'https://aapi3.autotrac-online.com.br/aticapi';
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const ACCOUNT_CODE = 10849;
const VALID_MACROS = [1, 2, 3, 4, 5, 6, 9, 10];

function getHeaders() {
  return {
    'Authorization': `Basic ${USER}:${PASS}`,
    'Ocp-Apim-Subscription-Key': API_KEY,
    'Content-Type': 'application/json'
  };
}

function isWithinLast48Hours(messageTimeStr) {
  if (!messageTimeStr) return false;
  try {
    const msgDate = new Date(messageTimeStr);
    const now = new Date();
    const diffMs = now - msgDate;
    const diff48h = 48 * 60 * 60 * 1000;
    return diffMs >= 0 && diffMs <= diff48h;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { vehicleCode, debug = false } = await req.json();

    if (!vehicleCode) {
      return Response.json({ error: 'vehicleCode é obrigatório' }, { status: 400 });
    }

    const url = `${PROD_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles/${vehicleCode}/returnmessages`;
    const res = await fetch(url, { headers: getHeaders() });

    if (!res.ok) {
      return Response.json({ 
        success: false, 
        error: `HTTP ${res.status}`,
        vehicleCode
      }, { status: 500 });
    }

    const data = await res.json();
    const allMessages = data.Data || [];

    if (debug) {
      return Response.json({
        success: true,
        vehicleCode,
        debug: true,
        total_messages: allMessages.length,
        raw_sample: allMessages.slice(0, 3)
      });
    }

    // Filtrar: apenas macros válidas e últimas 48h
    const validMessages = allMessages.filter(msg => {
      const macroNum = parseMacroNumber(msg);
      if (!VALID_MACROS.includes(macroNum)) return false;
      
      const createdDate = parseDateTime(msg.CreatedDate);
      return isWithinLast48Hours(createdDate);
    });

    return Response.json({
      success: true,
      vehicleCode,
      total_messages: allMessages.length,
      valid_messages: validMessages.length,
      messages: validMessages.map(msg => ({
        id: msg.Id,
        macroNumber: parseMacroNumber(msg),
        createdDate: msg.CreatedDate,
        message: msg.Description || ''
      }))
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});