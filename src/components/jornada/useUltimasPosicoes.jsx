import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Hook que busca a última posição gravada no banco para uma lista de veículos.
 * - Hoje: consulta o banco com polling.
 * - Dias históricos: consulta o banco sem polling.
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

  const fetchPositions = useCallback(async () => {
    if (!vehicleCodes.length || !companyId) return;
    const date = selectedDate || hoje;
    setLoading(true);
    try {
      const res = await base44.functions.invoke('listarPosicoesBanco', {
        vehicleCodes,
        company_id: companyId,
        date,
      });
      setPositions(res.data?.positions || {});
    } catch (e) {
      console.error('Erro ao buscar posições no banco:', e);
    } finally {
      setLoading(false);
    }
  }, [codesKey, companyId, selectedDate, hoje]);

  useEffect(() => {
    clearInterval(timerRef.current);
    setPositions({});

    fetchPositions();
    if (isHoje && intervalMs) {
      timerRef.current = setInterval(fetchPositions, intervalMs);
    }

    return () => clearInterval(timerRef.current);
  }, [isHoje, fetchPositions, intervalMs]);

  return { positions, loading };
}