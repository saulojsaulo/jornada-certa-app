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

  const hoje = new Date().toISOString().split('T')[0];
  const isHoje = !selectedDate || selectedDate === hoje;

  const fetchPositionsHoje = useCallback(async () => {
    if (!vehicleCodes.length || !companyId) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke('buscarUltimasPosicoes', {
        vehicleCodes,
        company_id: companyId,
      });
      if (res.data?.positions) {
        setPositions(res.data.positions);
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
          const registros = await base44.entities.PosicaoVeiculo.filter(
            { vehicle_code: code, company_id: companyId },
            '-data_posicao',
            1
          );
          if (registros.length > 0) {
            const r = registros[0];
            // Checar se é do dia selecionado ou próximo
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