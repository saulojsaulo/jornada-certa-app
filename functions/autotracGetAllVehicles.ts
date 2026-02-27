import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PROD_URL = 'https://aapi3.autotrac-online.com.br/aticapi';
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const ACCOUNT_NUMBER = '268532276';
const PAGE_SIZE = 1000;

function getHeaders(useRawAuth = false) {
  const headers = {
    'Ocp-Apim-Subscription-Key': API_KEY,
    'Content-Type': 'application/json'
  };
  
  if (useRawAuth) {
    headers['Authorization'] = `${USER}:${PASS}`;
  } else {
    headers['Authorization'] = `Basic ${btoa(`${USER}:${PASS}`)}`;
  }
  
  return headers;
}

async function discoverAccountCode() {
  try {
    const url = `${PROD_URL}/v1/accounts`;
    const res = await fetch(url, { headers: getHeaders() });
    
    if (!res.ok) return null;
    
    const data = await res.json();
    const accounts = data.Data || [];
    
    const targetAccount = accounts.find(acc => String(acc.AccountNumber) === ACCOUNT_NUMBER);
    return targetAccount ? targetAccount.Code : null;
  } catch {
    return null;
  }
}

async function fetchVehiclesWithUrl(url, useRawAuth = false) {
  try {
    const res = await fetch(url, { headers: getHeaders(useRawAuth) });
    if (!res.ok) return null;
    
    const data = await res.json();
    return data.Data || [];
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // 1. Descobrir o Account Code interno
    const internalCode = await discoverAccountCode();
    const accountCodeToUse = internalCode || '10849'; // fallback para o original

    const allVehicles = [];
    let offset = 0;
    let successUrl = null;

    // 2. Tentar múltiplas URLs em sequência
    const urlVariations = [
      `${PROD_URL}/v1/accounts/${accountCodeToUse}/vehicles?_limit=${PAGE_SIZE}`,
      `${PROD_URL}/v1/accounts/${ACCOUNT_NUMBER}/vehicles?_limit=${PAGE_SIZE}`,
      `${PROD_URL}/v1/accounts/${accountCodeToUse}/vehicles?limit=${PAGE_SIZE}`,
      `${PROD_URL}/v1/accounts/${accountCodeToUse}/vehicles`
    ];

    let vehicles = null;
    for (const url of urlVariations) {
      // Tentar com Base64 first
      vehicles = await fetchVehiclesWithUrl(url, false);
      if (vehicles && vehicles.length > 0) {
        successUrl = url;
        break;
      }
      
      // Se falhou, tentar com Raw auth
      vehicles = await fetchVehiclesWithUrl(url, true);
      if (vehicles && vehicles.length > 0) {
        successUrl = url;
        break;
      }
    }

    if (!vehicles) {
      return Response.json({
        error: 'Nenhuma URL funcionou para buscar veículos',
        attempted_urls: urlVariations,
        internal_code: internalCode,
        account_to_use: accountCodeToUse
      }, { status: 500 });
    }

    allVehicles.push(...vehicles);

    return Response.json({
      success: true,
      total: allVehicles.length,
      internal_code: internalCode,
      account_used: accountCodeToUse,
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