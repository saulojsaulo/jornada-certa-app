// Mapeamento de macros
export const MACRO_NAMES = {
  1: 'Início de Jornada',
  2: 'Fim de Jornada',
  3: 'Início de Refeição',
  4: 'Fim de Refeição',
  5: 'Início de Repouso',
  6: 'Fim de Repouso',
  9: 'Início Complemento Interjornada',
  10: 'Fim Complemento Interjornada'
};

// Pares de macros (início -> fim)
export const MACRO_PAIRS = {
  1: 2,  // Jornada
  3: 4,  // Refeição
  5: 6,  // Repouso
  9: 10  // Complemento
};

// Limites diários por macro
export const DAILY_LIMITS = {
  1: 1, 2: 1,
  3: 2, 4: 2,
  5: 5, 6: 5,
  9: 1, 10: 1
};

// Status possíveis
export const STATUS_CONFIG = {
  'Em Jornada': { color: 'bg-green-100 text-green-800', rowColor: 'bg-green-50' },
  'Em Refeição': { color: 'bg-amber-100 text-amber-800', rowColor: 'bg-amber-50' },
  'Em Repouso': { color: 'bg-purple-100 text-purple-800', rowColor: 'bg-purple-50' },
  'Em Complemento': { color: 'bg-blue-100 text-blue-800', rowColor: 'bg-blue-50' },
  'Fim de Jornada': { color: 'bg-orange-100 text-orange-800', rowColor: 'bg-orange-50' },
  'Sem Jornada': { color: 'bg-gray-100 text-gray-800', rowColor: 'bg-gray-50' }
};

// Converter minutos para formato HH:MM
export function minutesToHHMM(minutes) {
  if (minutes === null || minutes === undefined || isNaN(minutes)) return '--:--';
  const sign = minutes < 0 ? '-' : '';
  const absMinutes = Math.abs(Math.floor(minutes));
  const h = Math.floor(absMinutes / 60);
  const m = absMinutes % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Calcular diferença em minutos entre duas datas
export function diffInMinutes(start, end) {
  if (!start || !end) return 0;
  const startDate = new Date(start);
  const endDate = new Date(end);
  return (endDate - startDate) / (1000 * 60);
}

// Obter status atual do veículo baseado nas macros do dia
export function getVehicleStatus(macros) {
  if (!macros || macros.length === 0) return 'Sem Jornada';

  // Filtrar macros não excluídos
  const activeMacros = macros.filter(m => !m.excluido);
  if (activeMacros.length === 0) return 'Sem Jornada';

  const sorted = [...activeMacros].sort((a, b) => new Date(a.data_criacao) - new Date(b.data_criacao));
  const lastMacro = sorted[sorted.length - 1];
  
  // Verificar macros abertas
  const has1 = sorted.some(m => m.numero_macro === 1);
  const has2 = sorted.some(m => m.numero_macro === 2);
  
  // Contar pares abertos
  const count3 = sorted.filter(m => m.numero_macro === 3).length;
  const count4 = sorted.filter(m => m.numero_macro === 4).length;
  const count5 = sorted.filter(m => m.numero_macro === 5).length;
  const count6 = sorted.filter(m => m.numero_macro === 6).length;
  const count9 = sorted.filter(m => m.numero_macro === 9).length;
  const count10 = sorted.filter(m => m.numero_macro === 10).length;
  
  // Verificar status atual
  if (count3 > count4) return 'Em Refeição';
  if (count5 > count6) return 'Em Repouso';
  if (count9 > count10) return 'Em Complemento';
  if (has2) return 'Fim de Jornada';
  if (has1) return 'Em Jornada';
  
  return 'Sem Jornada';
}

// Calcular jornada bruta (macro 1 até macro 2 ou agora)
export function calcularJornadaBruta(macros) {
  if (!macros || macros.length === 0) return 0;
  
  // Filtrar macros não excluídos
  const activeMacros = macros.filter(m => !m.excluido);
  if (activeMacros.length === 0) return 0;
  
  const sorted = [...activeMacros].sort((a, b) => new Date(a.data_criacao) - new Date(b.data_criacao));
  const macro1 = sorted.find(m => m.numero_macro === 1);
  const macro2 = sorted.find(m => m.numero_macro === 2);
  
  if (!macro1) return 0;
  
  const end = macro2 ? new Date(macro2.data_criacao) : new Date();
  return diffInMinutes(macro1.data_criacao, end);
}

// Calcular total de pausas
export function calcularPausas(macros) {
  if (!macros || macros.length === 0) return { refeicao: 0, repouso: 0, complemento: 0, total: 0 };
  
  // Filtrar macros não excluídos
  const activeMacros = macros.filter(m => !m.excluido);
  if (activeMacros.length === 0) return { refeicao: 0, repouso: 0, complemento: 0, total: 0 };
  
  const sorted = [...activeMacros].sort((a, b) => new Date(a.data_criacao) - new Date(b.data_criacao));
  
  let refeicao = 0;
  let repouso = 0;
  let complemento = 0;
  
  // Calcular pausas de refeição (3 -> 4)
  const macros3 = sorted.filter(m => m.numero_macro === 3);
  const macros4 = sorted.filter(m => m.numero_macro === 4);
  for (let i = 0; i < Math.min(macros3.length, macros4.length); i++) {
    refeicao += diffInMinutes(macros3[i].data_criacao, macros4[i].data_criacao);
  }
  // Se há refeição aberta, calcular até agora
  if (macros3.length > macros4.length) {
    refeicao += diffInMinutes(macros3[macros3.length - 1].data_criacao, new Date());
  }
  
  // Calcular pausas de repouso (5 -> 6)
  const macros5 = sorted.filter(m => m.numero_macro === 5);
  const macros6 = sorted.filter(m => m.numero_macro === 6);
  for (let i = 0; i < Math.min(macros5.length, macros6.length); i++) {
    repouso += diffInMinutes(macros5[i].data_criacao, macros6[i].data_criacao);
  }
  if (macros5.length > macros6.length) {
    repouso += diffInMinutes(macros5[macros5.length - 1].data_criacao, new Date());
  }
  
  // Calcular pausas de complemento (9 -> 10)
  const macros9 = sorted.filter(m => m.numero_macro === 9);
  const macros10 = sorted.filter(m => m.numero_macro === 10);
  for (let i = 0; i < Math.min(macros9.length, macros10.length); i++) {
    complemento += diffInMinutes(macros9[i].data_criacao, macros10[i].data_criacao);
  }
  if (macros9.length > macros10.length) {
    complemento += diffInMinutes(macros9[macros9.length - 1].data_criacao, new Date());
  }
  
  return {
    refeicao,
    repouso,
    complemento,
    total: refeicao + repouso + complemento
  };
}

// Calcular jornada líquida
export function calcularJornadaLiquida(macros) {
  const bruta = calcularJornadaBruta(macros);
  const pausas = calcularPausas(macros);
  return Math.max(0, bruta - pausas.total);
}

// Calcular horas extras (acima de 8h)
export function calcularHorasExtras(macros) {
  const liquida = calcularJornadaLiquida(macros);
  return Math.max(0, liquida - 480); // 480 = 8 horas
}

// Calcular tempo disponível (12h - jornada atual)
export function calcularTempoDisponivel(macros) {
  const liquida = calcularJornadaLiquida(macros);
  return Math.max(0, 720 - liquida); // 720 = 12 horas
}

// Calcular interjornada (intervalo entre macro 2 do dia anterior e macro 1 do dia atual)
export function calcularInterjornada(macrosHoje, macrosOntem) {
  if (!macrosHoje || macrosHoje.length === 0 || !macrosOntem || macrosOntem.length === 0) {
    return null;
  }
  
  // Filtrar macros não excluídos
  const activeHoje = macrosHoje.filter(m => !m.excluido);
  const activeOntem = macrosOntem.filter(m => !m.excluido);
  
  if (activeHoje.length === 0 || activeOntem.length === 0) return null;
  
  const sortedHoje = [...activeHoje].sort((a, b) => new Date(a.data_criacao) - new Date(b.data_criacao));
  const sortedOntem = [...activeOntem].sort((a, b) => new Date(a.data_criacao) - new Date(b.data_criacao));
  
  const macro1Hoje = sortedHoje.find(m => m.numero_macro === 1);
  const macro2Ontem = sortedOntem.find(m => m.numero_macro === 2);
  
  if (!macro1Hoje || !macro2Ontem) return null;
  
  return diffInMinutes(macro2Ontem.data_criacao, macro1Hoje.data_criacao);
}

// Verificar alerta de refeição (> 6h sem refeição)
export function verificarAlertaRefeicao(macros) {
  if (!macros || macros.length === 0) return false;

  // Filtrar macros não excluídos
  const activeMacros = macros.filter(m => !m.excluido);
  if (activeMacros.length === 0) return false;

  const sorted = [...activeMacros].sort((a, b) => new Date(a.data_criacao) - new Date(b.data_criacao));
  const macro1 = sorted.find(m => m.numero_macro === 1);
  const macro2 = sorted.find(m => m.numero_macro === 2);
  
  if (!macro1 || macro2) return false; // Sem jornada ou já encerrada
  
  // Contar macros de refeição
  const count3 = sorted.filter(m => m.numero_macro === 3).length;
  const count4 = sorted.filter(m => m.numero_macro === 4).length;
  
  // Se já completou pelo menos 1 refeição, não alertar mais
  if (count4 > 0) return false;
  
  // Se está em refeição (macro 3 aberta), não alertar
  if (count3 > count4) return false;
  
  const tempoDesdeInicio = diffInMinutes(macro1.data_criacao, new Date());
  return tempoDesdeInicio > 360; // 360 = 6 horas
}

// Verificar alertas de interjornada
export function verificarAlertasInterjornada(interjornadaMinutos, macrosHoje) {
  if (interjornadaMinutos === null) return { alerta11h: false, alerta8h: false };
  
  // Se há macros hoje, verificar se já enviou macro de complemento (9)
  if (macrosHoje && macrosHoje.length > 0) {
    const activeMacros = macrosHoje.filter(m => !m.excluido);
    const macro9 = activeMacros.find(m => m.numero_macro === 9);
    
    // Se enviou macro 9, não mostrar mais alerta de interjornada
    if (macro9) return { alerta11h: false, alerta8h: false };
  }
  
  return {
    alerta11h: interjornadaMinutos < 660, // < 11 horas
    alerta8h: interjornadaMinutos < 480   // < 8 horas
  };
}