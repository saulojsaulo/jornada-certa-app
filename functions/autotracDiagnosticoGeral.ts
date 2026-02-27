import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = Deno.env.get("AUTOTRAC_BASE_URL");
const API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
const USER = Deno.env.get("AUTOTRAC_USER");
const PASS = Deno.env.get("AUTOTRAC_PASS");

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Buscar TODOS os veículos
    const veiculos = await base44.asServiceRole.entities.Veiculo.list('-created_date', 1000);
    const veiculosComId = veiculos.filter(v => v.autotrac_id && v.ativo !== false);
    
    function fmtDate(d) {
      return d.toISOString().replace('T', ' ').substring(0, 19);
    }
    
    function getAuthHeaders() {
      return {
        'Authorization': `Basic ${USER}:${PASS}`,
        'Ocp-Apim-Subscription-Key': API_KEY,
        'Content-Type': 'application/json'
      };
    }
    
    const agora = new Date();
    const inicio48h = new Date(agora.getTime() - 48 * 60 * 60 * 1000);
    const startDateStr = fmtDate(inicio48h);
    const endDateStr = fmtDate(agora);
    const ACCOUNT_CODE = 10849;
    
    let comMensagens = [];
    let semMensagens = [];
    let comErro = [];
    
    // Processar em lotes de 20 para evitar timeout
    for (let i = 0; i < veiculosComId.length; i += 20) {
      const lote = veiculosComId.slice(i, i + 20);
      
      const promises = lote.map(async (veiculo) => {
        try {
          const url = `${BASE_URL}/v1/accounts/${ACCOUNT_CODE}/vehicles/${veiculo.autotrac_id}/returnmessages` +
            `?startDate=${encodeURIComponent(startDateStr)}&endDate=${encodeURIComponent(endDateStr)}` +
            `&limit=1&offset=0`;
            
          const res = await fetch(url, { headers: getAuthHeaders() });
          
          if (!res.ok) {
            comErro.push({ id: veiculo.autotrac_id, nome: veiculo.nome_veiculo, status: res.status });
            return;
          }
          
          const data = await res.json();
          const page = data.Data || data.data || (Array.isArray(data) ? data : []);
          
          if (page.length > 0) {
            comMensagens.push(veiculo.nome_veiculo);
          } else {
            semMensagens.push(veiculo.nome_veiculo);
          }
        } catch (err) {
            comErro.push({ id: veiculo.autotrac_id, nome: veiculo.nome_veiculo, erro: err.message });
        }
      });
      
      await Promise.all(promises);
      // pequeno delay entre lotes
      await new Promise(r => setTimeout(r, 500));
    }
    
    return Response.json({
      total_veiculos_autotrac: veiculosComId.length,
      qtd_com_mensagens_ultimas_48h: comMensagens.length,
      qtd_sem_mensagens_ultimas_48h: semMensagens.length,
      qtd_com_erro_api: comErro.length,
      veiculos_sem_mensagens: semMensagens,
      erros: comErro
    });
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});