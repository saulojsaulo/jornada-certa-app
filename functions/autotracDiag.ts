import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Diagnóstico: testa a URL base real e verifica o formato das mensagens de retorno
Deno.serve(async (req) => {
  try {
    const USER = Deno.env.get("AUTOTRAC_USER");
    const PASS = Deno.env.get("AUTOTRAC_PASS");
    const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
    const BASE_URL_ENV = Deno.env.get("AUTOTRAC_BASE_URL");

    const headers = {
      'Authorization': `Basic ${USER}:${PASS}`,
      'Ocp-Apim-Subscription-Key': API_KEY,
      'Content-Type': 'application/json'
    };

    const ACCOUNT_CODE = 10849;
    // URL correta conforme documentação
    const BASE_URL_DOC = 'https://aapi3.autotrac-online.com.br/aticapi';

    const results = {};

    // Teste 1: URL da variável de ambiente
    results.env_base_url = BASE_URL_ENV;
    results.doc_base_url = BASE_URL_DOC;

    // Teste 2: buscar primeiro veículo usando URL da documentação
    const vehiclesUrl = `${BASE_URL_DOC}/v1/accounts/${ACCOUNT_CODE}/vehicles?limit=1`;
    const vRes = await fetch(vehiclesUrl, { headers });
    results.vehicles_status = vRes.status;
    const vData = await vRes.json();
    results.vehicles_sample = JSON.stringify(vData).substring(0, 500);

    if (vRes.ok) {
      const vehicles = Array.isArray(vData) ? vData : (vData.Data || vData.data || []);
      if (vehicles.length > 0) {
        const v = vehicles[0];
        results.vehicle_keys = Object.keys(v);
        results.vehicle_code = v.Code || v.code;
        results.vehicle_name = v.Name || v.name;

        // Teste 3: buscar mensagens de retorno do primeiro veículo (últimas 12h - padrão sem filtro de data)
        const vehicleCode = v.Code || v.code;
        const msgUrl = `${BASE_URL_DOC}/v1/accounts/${ACCOUNT_CODE}/vehicles/${vehicleCode}/returnmessages`;
        const mRes = await fetch(msgUrl, { headers });
        results.messages_status = mRes.status;
        const mData = await mRes.json();
        results.messages_raw_type = typeof mData;
        results.messages_is_array = Array.isArray(mData);
        results.messages_keys = Array.isArray(mData) ? 'array' : Object.keys(mData);

        if (Array.isArray(mData) && mData.length > 0) {
          results.message_sample = mData[0];
          results.message_count = mData.length;
          results.has_IsLastPage = 'IsLastPage' in mData;
        } else if (!Array.isArray(mData)) {
          results.messages_data_keys = Object.keys(mData);
          const items = mData.Data || mData.data || mData.messages || [];
          results.messages_inner_count = items.length;
          if (items.length > 0) results.message_sample = items[0];
          results.has_IsLastPage = 'IsLastPage' in mData;
          results.IsLastPage_value = mData.IsLastPage;
        }

        // Teste 4: tentar com filtro de data (últimas 48h)
        const agora = new Date();
        const inicio = new Date(agora.getTime() - 48 * 60 * 60 * 1000);
        const fmtDate = (d) => d.toISOString().replace('T', ' ').substring(0, 19);
        const msgUrlFiltro = `${BASE_URL_DOC}/v1/accounts/${ACCOUNT_CODE}/vehicles/${vehicleCode}/returnmessages?startDate=${encodeURIComponent(fmtDate(inicio))}&endDate=${encodeURIComponent(fmtDate(agora))}`;
        results.url_com_filtro = msgUrlFiltro;
        const mFRes = await fetch(msgUrlFiltro, { headers });
        results.messages_filtro_status = mFRes.status;
        const mFData = await mFRes.json();
        const mFItems = Array.isArray(mFData) ? mFData : (mFData.Data || mFData.data || []);
        results.messages_filtro_count = mFItems.length;
        if (mFItems.length > 0) results.messages_filtro_sample = mFItems[0];
      }
    }

    // Teste 5: comparar com URL da variável de ambiente
    if (BASE_URL_ENV && BASE_URL_ENV !== BASE_URL_DOC) {
      const envUrl = `${BASE_URL_ENV}/v1/accounts/${ACCOUNT_CODE}/vehicles?limit=1`;
      const evRes = await fetch(envUrl, { headers });
      results.env_url_status = evRes.status;
    }

    return Response.json(results, { status: 200 });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});