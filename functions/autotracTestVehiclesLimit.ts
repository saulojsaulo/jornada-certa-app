import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");
const ACCOUNT_CODE = 10849;

Deno.serve(async (req) => {
  try {
    const url = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles?limit=500&offset=0`;
    const res = await fetch(url, { 
      headers: {
        'Authorization': `Basic ${USER}:${PASS}`,
        'Ocp-Apim-Subscription-Key': API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    if (!res.ok) {
      return Response.json({ error: `HTTP ${res.status}` }, { status: 500 });
    }
    
    const data = await res.json();
    const page = Array.isArray(data) ? data : (data.Data || data.data || []);
    
    return Response.json({
      totalReturned: page.length,
      isLastPage: data.IsLastPage,
      limitSent: 500
    });
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});