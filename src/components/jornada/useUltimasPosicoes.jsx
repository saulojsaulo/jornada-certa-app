import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Hook que busca a última posição de uma lista de veículos periodicamente.
 * @param {string[]} vehicleCodes - Lista de número de frota dos veículos
 * @param {string} companyId - ID da empresa
 * @param {number} intervalMs - Intervalo de atualização em ms (padrão: 60s)
 */
export function useUltimasPosicoes(vehicleCodes, companyId, intervalMs = 60000) {
  const [positions, setPositions] = useState({});
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);
  const codesKey = vehicleCodes.join(',');

  const fetchPositions = useCallback(async () => {
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

  useEffect(() => {
    fetchPositions();
    timerRef.current = setInterval(fetchPositions, intervalMs);
    return () => clearInterval(timerRef.current);
  }, [fetchPositions, intervalMs]);

  return { positions, loading };
}