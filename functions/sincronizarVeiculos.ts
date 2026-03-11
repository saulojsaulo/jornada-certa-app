import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { createClient } from 'npm:@supabase/supabase-js'; // IMPORTANTE: Adicione esta linha

const BASE_URL = 'https://aapi3.autotrac-online.com.br/aticapi/v1';

// Função auxiliar para cabeçalhos da Autotrac (mantida)
function autotracHeaders(usuario, senha, apiKey) {
  return {
    'Authorization': `Basic ${usuario}:${senha}`,
    'Ocp-Apim-Subscription-Key': apiKey,
    'Content-Type': 'application/json',
    'User-Agent': 'PostmanRuntime/7.37.0',
    'Cache-Control': 'no-cache',
  };
}

// Função auxiliar para chamadas GET da Autotrac (mantida)
async function autotracGet(url, headers, retries = 3) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        let res;
        try {
            res = await fetch(url, { headers, signal: controller.signal });
            clearTimeout(timeout);
        } catch (e) {
            clearTimeout(timeout);
            if (e.name === 'AbortError') throw new Error(`Timeout: ${url}`);
            throw e;
        }
        if (res.status === 429) {
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
                continue;
            }
            throw new Error('Rate limit exceeded');
        }
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`${res.status}: ${txt.substring(0, 200)}`);
        }
        return res.json();
    }
}


Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    // Para operações em entidades Base44 (como Empresas), ainda usamos base44.asServiceRole
    const db = base44.asServiceRole;

    // --- INICIALIZAÇÃO SUPABASE ---
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
        return new Response(JSON.stringify({ error: 'Supabase credentials not set in environment variables.' }), { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
            persistSession: false,
        },
    });
    // --- FIM INICIALIZAÇÃO SUPABASE ---

    const results = [];

    // --- BUSCAR EMPRESAS NO BASE44 ---
    // Continuamos a usar o Base44 Entities para gerenciar as configurações das empresas
    const empresas = await db.entities.Empresa.filter({ provedora_rastreamento: 'autotrac', ativa: true }, '-created_date', 100);
    if (!empresas?.length) {
        return new Response(JSON.stringify({ message: 'Nenhuma empresa Autotrac configurada.' }), { headers: { 'Content-Type': 'application/json' } });
    }

    for (const empresa of empresas) {
        const cfg = empresa.api_config || {};
        const usuario = cfg.autotrac_usuario || Deno.env.get('AUTOTRAC_USER');
        const senha   = cfg.autotrac_senha   || Deno.env.get('AUTOTRAC_PASS');
        const apiKey  = cfg.autotrac_api_key || Deno.env.get('AUTOTRAC_API_KEY');
        const accountNum = String(cfg.autotrac_account || Deno.env.get('AUTOTRAC_ACCOUNT') || '');

        if (!usuario || !senha || !apiKey) {
            results.push({ empresa: empresa.nome, error: 'Credenciais incompletas.' });
            continue;
        }

        const headers = autotracHeaders(usuario, senha, apiKey);

        try {
            // 1. Buscar accountCode (1 chamada)
            const accountsRaw = await autotracGet(`${BASE_URL}/accounts?_limit=500`, headers);
            const accountList = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.Data || []);
            const contas = accountNum ? accountList.filter(a => String(a.Number) === accountNum) : accountList;
            if (!contas.length) {
                results.push({ empresa: empresa.nome, error: `Conta ${accountNum} não encontrada.` });
                continue;
            }
            const accountCode = contas[0].Code;

            // 2. Buscar veículos existentes no SUPABASE para esta empresa
            const { data: veiculosSupabase, error: veiculosError } = await supabase
                .from('veiculos')
                .select('numero_frota, placa')
                .eq('company_id', empresa.id);

            if (veiculosError) throw new Error(veiculosError.message);

            const existingVehicles = new Set();
            veiculosSupabase.forEach(v => {
                if (v.numero_frota) existingVehicles.add(v.numero_frota);
                if (v.placa) existingVehicles.add(v.placa); // Adiciona placa também para verificação de duplicidade
            });

            // 3. Buscar veículos da API Autotrac
            const autotracVehiclesRaw = await autotracGet(`${BASE_URL}/accounts/${accountCode}/vehicles?_limit=500`, headers);
            const autotracVehicles = Array.isArray(autotracVehiclesRaw) ? autotracVehiclesRaw : (autotracVehiclesRaw.Data || []);

            const newVehiclesToUpsert = [];
            let createdCount = 0;
            let updatedCount = 0;

            for (const autotracVehicle of autotracVehicles) {
                const vehicleCode = String(autotracVehicle.Code);
                const licensePlate = autotracVehicle.LicensePlate ? String(autotracVehicle.LicensePlate) : null;
                const vehicleName = autotracVehicle.Name ? String(autotracVehicle.Name) : licensePlate || vehicleCode;

                // Verifica se já existe pelo numero_frota (Code) ou placa
                if (!existingVehicles.has(vehicleCode) && (!licensePlate || !existingVehicles.has(licensePlate))) {
                    newVehiclesToUpsert.push({
                        nome_veiculo: vehicleName,
                        numero_frota: vehicleCode,
                        placa: licensePlate,
                        ativo: true,
                        company_id: empresa.id,
                        // id: gen_random_uuid() será gerado pelo Supabase
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                        created_by: 'autotrac_sync_function' // Ou user.email se a função fosse chamada por um usuário
                    });
                } else {
                     // Se o veículo já existe, podemos adicionar lógica para atualizar campos se necessário
                     // Por exemplo, se o nome ou a placa mudarem na Autotrac
                     // Para simplicidade, neste exemplo, focamos apenas em criar novos.
                     // Em um cenário real, você faria um 'upsert' com base em 'numero_frota'
                     // e atualizaria os outros campos.
                     // Para a estrutura de upsert que vamos usar, o Supabase vai lidar com isso.
                }
            }

            // --- PERSISTIR VEÍCULOS NO SUPABASE ---
            // Usamos upsert para inserir novos veículos ou atualizar existentes
            // O `onConflict` indica qual coluna o Supabase deve usar para verificar se um registro já existe.
            // Aqui, usamos 'numero_frota' como identificador único da Autotrac.
            if (newVehiclesToUpsert.length > 0) {
                const { data, error: upsertError } = await supabase
                    .from('veiculos')
                    .upsert(newVehiclesToUpsert, { onConflict: 'numero_frota' })
                    .select('id, numero_frota'); // Seleciona o ID para saber o que foi upsertado

                if (upsertError) throw new Error(upsertError.message);

                createdCount = data.length; // Quantidade de registros criados ou atualizados
            }

            results.push({
                empresa: empresa.nome,
                created_or_updated: createdCount, // Retorna o número de itens upsertados
                autotrac_processed: autotracVehicles.length,
            });

        } catch (e) {
            results.push({ empresa: empresa.nome, error: e.message });
        }
    }

    return new Response(JSON.stringify({ success: true, timestamp: new Date().toISOString(), results }), {
        headers: { 'Content-Type': 'application/json' }
    });
});