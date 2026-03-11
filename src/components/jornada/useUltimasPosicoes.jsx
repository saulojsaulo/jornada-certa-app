import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Hook que busca a última posição de uma lista de veículos.
 * - Hoje: busca da API em tempo real via buscarUltimasPosicoes com polling.
 * - Dias históricos: busca do banco (PosicaoVeiculo) sem polling.
 *
 * @param {string[]} vehicleCodes
 * @param {string} companyId
 * @param {number|null} intervalMs - null desativa polling
 * @param {string} selectedDate - "YYYY-MM-DD", undefined = hoje
 */
export function useUltimasPosicoes(vehicleCodes, companyId, intervalMs = 60000, selectedDate) {
  const [positions, setPositions] = useState({});
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);
  const codesKey = vehicleCodes.join(',');

  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const isHoje = !selectedDate || selectedDate === hoje;

  const fetchPositionsHoje = useCallback(async () => {
    if (!vehicleCodes.length || !companyId) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke('buscarUltimasPosicoes', {
        vehicleCodes,
        company_id: companyId,
      });
      console.log('Resposta buscarUltimasPosicoes:', res.data);
      if (res.data?.positions) {
        console.log('Positions recebidas:', res.data.positions);
        setPositions(res.data.positions);
      } else {
        console.warn('Nenhuma position retornada na resposta');
      }
    } catch (e) {
      console.error('Erro ao buscar últimas posições:', e);
    } finally {
      setLoading(false);
    }
  }, [codesKey, companyId]);

  const fetchPositionsHistorico = useCallback(async () => {
    if (!vehicleCodes.length || !companyId || !selectedDate) return;
    setLoading(true);
    try {
      // Buscar última posição de cada veículo no dia selecionado do banco
      const result = {};
      // Buscar em paralelo por lotes de 5
      const CHUNK = 5;
      for (let i = 0; i < vehicleCodes.length; i += CHUNK) {
        const chunk = vehicleCodes.slice(i, i + CHUNK);
        await Promise.all(chunk.map(async (code) => {
          // Buscar mais registros para poder filtrar pelo dia correto no fuso de SP
          const registros = await base44.entities.PosicaoVeiculo.filter(
            { vehicle_code: code, company_id: companyId },
            '-data_posicao',
            200
          );
          // Filtrar posições dentro do dia selecionado no horário de SP (UTC-3)
          const dayStart = new Date(`${selectedDate}T00:00:00-03:00`).getTime();
          const dayEnd   = new Date(`${selectedDate}T23:59:59-03:00`).getTime();
          const dosDia = registros.filter(r => {
            if (!r.data_posicao) return false;
            const t = new Date(r.data_posicao).getTime();
            return t >= dayStart && t <= dayEnd;
          });
          if (dosDia.length > 0) {
            const r = dosDia[0]; // já ordenado por -data_posicao (mais recente primeiro)
            result[code] = {
              lat: r.latitude,
              lng: r.longitude,
              address: r.endereco,
              time: r.data_posicao,
            };
          }
        }));
      }
      setPositions(result);
    } catch (e) {
      console.error('Erro ao buscar posições históricas:', e);
    } finally {
      setLoading(false);
    }
  }, [codesKey, companyId, selectedDate]);

  useEffect(() => {
    clearInterval(timerRef.current);
    setPositions({});

    if (isHoje) {
      fetchPositionsHoje();
      if (intervalMs) {
        timerRef.current = setInterval(fetchPositionsHoje, intervalMs);
      }
    } else {
      fetchPositionsHistorico();
    }

    return () => clearInterval(timerRef.current);
  }, [isHoje, fetchPositionsHoje, fetchPositionsHistorico, intervalMs]);

  return { positions, loading };
}