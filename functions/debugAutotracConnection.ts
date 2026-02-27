const AUTOTRAC_BASE_URL = Deno.env.get('AUTOTRAC_BASE_URL');
const AUTOTRAC_ACCOUNT = Deno.env.get('AUTOTRAC_ACCOUNT');
const AUTOTRAC_USER = Deno.env.get('AUTOTRAC_USER');
const AUTOTRAC_PASS = Deno.env.get('AUTOTRAC_PASS');
const AUTOTRAC_API_KEY = Deno.env.get('AUTOTRAC_API_KEY');

function getHeaders() {
  const credentials = btoa(`${AUTOTRAC_USER}:${AUTOTRAC_PASS}`);
  return {
    'Authorization': `Basic ${credentials}`,
    'Ocp-Apim-Subscription-Key': AUTOTRAC_API_KEY,
    'Content-Type': 'application/json'
  };
}

Deno.serve(async (req) => {
  try {
    console.log('=== DEBUG AUTOTRAC CONNECTION ===');
    console.log(`BASE_URL: ${AUTOTRAC_BASE_URL}`);
    console.log(`ACCOUNT: ${AUTOTRAC_ACCOUNT}`);
    console.log(`USER: ${AUTOTRAC_USER}`);
    console.log(`API_KEY length: ${AUTOTRAC_API_KEY?.length || 0}`);

    const url = `${AUTOTRAC_BASE_URL}/${AUTOTRAC_ACCOUNT}/v2/vehicles?page=1&pageSize=10`;
    console.log(`Testing URL: ${url}`);

    const response = await fetch(url, { headers: getHeaders() });
    console.log(`Response status: ${response.status}`);
    
    const body = await response.text();
    console.log(`Response body: ${body}`);

    return Response.json({
      url,
      status: response.status,
      body: body.substring(0, 1000)
    });
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});