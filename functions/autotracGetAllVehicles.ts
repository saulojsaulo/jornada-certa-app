import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PROD_URL = 'https://aapi3.autotrac-online.com.br/aticapi';
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const ACCOUNT_CODE = 10849;

function getHeaders() {
  return {
    'Authorization': `Basic ${btoa(`${USER}:${PASS}`)}`,
    'Ocp-Apim-Subscription-Key': API_KEY,
    'Content-Type': 'application/json'
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const allVehicles = [];

    // Tentar com _limit=1000 primeiro, depois fallback para limit
    const urlVariations = [
      `${PROD_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles?_limit=1000`,
      `${PROD_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles?limit=1000`,
      `${PROD_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles`
    ];

    let vehicles = null;
    let successUrl = null;

    for (const url of urlVariations) {
      try {
        const res = await fetch(url, { headers: getHeaders() });
        if (res.ok) {
          const data = await res.json();
          vehicles = data.Data || [];
          if (vehicles.length > 0) {
            successUrl = url;
            break;
          }
        }
      } catch {
        // Continua para próxima URL
      }
    }

    if (!vehicles || vehicles.length === 0) {
      return Response.json({
        error: 'Nenhum veículo encontrado em nenhuma URL',
        attempted_urls: urlVariations
      }, { status: 500 });
    }

    allVehicles.push(...vehicles);

    return Response.json({
      success: true,
      total: allVehicles.length,
      success_url: successUrl,
      vehicles: allVehicles.map(v => ({
        id: `temp_${v.Code}`,
        autotrac_id: String(v.Code),
        nome_veiculo: v.Name || `Veículo ${v.Code}`,
        placa: v.LicensePlate || '',
        numero_frota: String(v.Address || ''),
        ativo: true,
        created_date: new Date().toISOString(),
        updated_date: new Date().toISOString()
      }))
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});