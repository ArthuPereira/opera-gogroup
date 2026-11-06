import {
  ActionOptionQuote,
  AutoTriageCategory,
  CarrierRoute,
  ContainmentOrder,
  Customer,
  EnrichedOrder,
  OrderEconomicsSummary,
  OrderRecord,
  RawOrder,
  RecommendedActionType,
} from "./types";

export const REFERENCE_DATE = "2026-09-30";

export const NATIONAL_HOLIDAYS = new Set<string>([
  "2026-09-07",
  "2026-10-12",
]);

export const NORTHEAST_CRITICAL_UFS = new Set<string>([
  "CE",
  "PB",
  "PE",
  "BA",
  "RN",
]);

export const SAC_CONTACT_COST_BRL = 9.0;
export const CMV_RATE = 0.24;
export const VIP_REVENUE_THRESHOLD_BRL = 1500;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Normaliza datas vindas de CSV ou formulários (aceita YYYY-MM-DD, ISO completo ou DD/MM/YYYY).
 * Evita RangeError (Invalid time value) em d.toISOString().
 */
export function normalizeIsoDate(
  raw: string | null | undefined,
  fallback: string = REFERENCE_DATE
): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const candidate = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    const d = new Date(`${candidate}T12:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === candidate) {
      return candidate;
    }
  }
  const brMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (brMatch) {
    const candidate = `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
    const d = new Date(`${candidate}T12:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === candidate) {
      return candidate;
    }
  }
  return fallback;
}

export function isBusinessDay(isoDate: string): boolean {
  const safeIso = normalizeIsoDate(isoDate);
  const d = new Date(`${safeIso}T12:00:00Z`);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !NATIONAL_HOLIDAYS.has(safeIso);
}

/**
 * Soma `businessDays` dias úteis a partir de `startIsoDate`.
 * Conforme parametros.md: a contagem começa no 1º dia útil após o pedido (dia de separação = dia 1).
 */
export function addBusinessDays(startIsoDate: string, businessDays: number): string {
  const safeStart = normalizeIsoDate(startIsoDate);
  const d = new Date(`${safeStart}T12:00:00Z`);
  let added = 0;
  while (added < businessDays) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !NATIONAL_HOLIDAYS.has(iso)) {
      added++;
    }
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Conta quantos dias úteis de atraso existem entre `dueIsoDate` e `refIsoDate`.
 * Se `refIsoDate <= dueIsoDate`, retorna 0.
 */
export function countBusinessDaysBetween(dueIsoDate: string, refIsoDate: string): number {
  if (!dueIsoDate || !refIsoDate) return 0;
  const safeDue = normalizeIsoDate(dueIsoDate);
  const safeRef = normalizeIsoDate(refIsoDate);
  if (safeRef <= safeDue) return 0;
  const d = new Date(`${safeDue}T12:00:00Z`);
  const end = new Date(`${safeRef}T12:00:00Z`);
  let count = 0;
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !NATIONAL_HOLIDAYS.has(iso)) {
      count++;
    }
  }
  return count;
}

export function countCalendarDaysBetween(startIso: string, endIso: string): number {
  if (!startIso || !endIso) return 0;
  const safeStart = normalizeIsoDate(startIso);
  const safeEnd = normalizeIsoDate(endIso);
  const start = new Date(`${safeStart}T12:00:00Z`).getTime();
  const end = new Date(`${safeEnd}T12:00:00Z`).getTime();
  return Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
}

/**
 * Calcula a data real contratada: 1 dia útil de separação + SLA contratado da transportadora em dias úteis.
 */
export function calculateRealDueDate(dataPedido: string, carrierSlaBusinessDays: number): string {
  return addBusinessDays(dataPedido, 1 + carrierSlaBusinessDays);
}

/**
 * Classificação determinística e mutuamente exclusiva da Camada de Auto-Triagem (Zero Fila Humana).
 * Na base original de 2.042 pedidos: 241 (Regra A) + 142 (Regra B) + 73 (Regra C) = 456 casos.
 */
export function classifyAutoTriage(
  order: Pick<RawOrder, "tipo_excecao" | "data_entrega" | "status">,
  realDueDate: string,
  referenceDate: string = REFERENCE_DATE
): { category: AutoTriageCategory; note: string } {
  if (order.tipo_excecao === "atraso_entrega" && Boolean(order.data_entrega)) {
    return {
      category: "auto_encerrado_entregue",
      note: `Pedido já entregue em ${order.data_entrega}. Exceção de atraso encerrada automaticamente sem consumir fila humana.`,
    };
  }

  if (order.tipo_excecao === "pagamento_pendente") {
    return {
      category: "auto_cobranca_pix",
      note:
        order.status === "aguardando_transportadora"
          ? "Pagamento pendente c/ status inconsistente (aguardando_transportadora): bloqueada expedição indevida e disparado link Pix automático 24h c/ liberação de estoque."
          : "Disparo automático de lembrete/link Pix (janela 24h) e expiração programada de reserva de estoque sem intervenção humana.",
    };
  }

  if (
    order.tipo_excecao === "atraso_entrega" &&
    !order.data_entrega &&
    referenceDate <= realDueDate
  ) {
    return {
      category: "auto_aviso_falso_atraso",
      note: `Falso atraso gerado pelo bug de dias corridos no checkout. Prazo real contratado é ${realDueDate} (ainda vigente em ${referenceDate}). Cliente notificado proativamente.`,
    };
  }

  return {
    category: "none",
    note: "",
  };
}

/**
 * Probabilidade de cancelamento por atraso conforme tabela oficial de parametros.md
 */
export function getCancelProbabilityByDelay(businessDaysLate: number): number {
  if (businessDaysLate <= 0) return 0;
  if (businessDaysLate <= 2) return 0.04;
  if (businessDaysLate <= 5) return 0.10;
  if (businessDaysLate <= 10) return 0.22;
  return 0.40;
}

/**
 * Urgência marginal ("Cliff" de SLA): identifica pedidos no último dia útil antes de saltar de faixa
 */
export function getMarginalDelayCliff(
  businessDaysLate: number,
  realDueDate: string,
  referenceDate: string = REFERENCE_DATE
): { nextCliffDaysLeft: number | null; deltaProb: number } {
  if (businessDaysLate === 0 && realDueDate === referenceDate) {
    return { nextCliffDaysLeft: 1, deltaProb: 0.04 };
  }
  if (businessDaysLate === 2) {
    return { nextCliffDaysLeft: 1, deltaProb: 0.06 }; // 4% -> 10%
  }
  if (businessDaysLate === 5) {
    return { nextCliffDaysLeft: 1, deltaProb: 0.12 }; // 10% -> 22%
  }
  if (businessDaysLate === 10) {
    return { nextCliffDaysLeft: 1, deltaProb: 0.18 }; // 22% -> 40%
  }
  return { nextCliffDaysLeft: null, deltaProb: 0 };
}

export function calculateCustomerLtvMetrics(customer: Customer | undefined, fallbackOrderValue: number) {
  const accumulatedRevenue = customer?.receita_acumulada ?? fallbackOrderValue;
  const orderCount = Math.max(1, customer?.n_pedidos ?? 1);
  const isVip = accumulatedRevenue > VIP_REVENUE_THRESHOLD_BRL;
  const ticketAverage = round2(accumulatedRevenue / orderCount);
  // Queda pela metade na recompra de 12m: 70% -> 35% (delta 0.35) para VIP; 28% -> 14% (delta 0.14) para regular
  const repurchaseDropProb = isVip ? 0.35 : 0.14;
  const ltvAtRiskBRL = round2(ticketAverage * repurchaseDropProb);

  return {
    isVip,
    accumulatedRevenue: round2(accumulatedRevenue),
    orderCount,
    ticketAverage,
    repurchaseDropProb,
    ltvAtRiskBRL,
  };
}

export function detectOrderAnomalyFlags(order: RawOrder, realDueDate: string): string[] {
  const flags: string[] = [];

  if (order.data_prometida && order.data_prometida < realDueDate) {
    flags.push("Bug Checkout: Dias Corridos");
  }
  if (order.maquina === "IMP-02" && order.tipo_excecao === "falha_personalizacao") {
    flags.push("Gargalo IMP-02 (CD1)");
  }
  if (order.lote_produto === "L2607-B" && order.tipo_excecao === "vazamento_produto") {
    flags.push("Lote Defeituoso L2607-B");
  }
  if (order.cd === "CD2" && order.turno === "noite" && order.tipo_excecao === "item_faltante") {
    flags.push(order.brinde_no_pedido ? "Picking CD2 Noite (Brinde)" : "Picking CD2 Noite");
  }
  if (
    order.transportadora === "Rota Express" &&
    NORTHEAST_CRITICAL_UFS.has(order.uf) &&
    ["atraso_entrega", "rastreio_parado", "extravio"].includes(order.tipo_excecao)
  ) {
    flags.push(`Malha Rota Express NE (${order.uf})`);
  }
  if (order.transportadora === "Carga Norte" && order.tipo_excecao === "avaria_transporte") {
    flags.push(
      order.marca === "Lescent"
        ? "Avaria Vidro Lescent / Carga Norte"
        : "Avaria Carga Norte"
    );
  }
  if (
    order.tipo_excecao === "ruptura_pos_venda" &&
    order.marca === "Kokeshi" &&
    ["KSH-1010", "KSH-1011", "KSH-1009"].includes(order.sku)
  ) {
    flags.push(`Ruptura Crônica ${order.sku}`);
  }
  if (order.tipo_excecao === "devolvido_transportadora" && order.marca === "Gocase") {
    flags.push("Personalizado Sem Revenda (Gocase)");
  }

  return flags;
}

export function calculateDirectOrderRisk(
  order: RawOrder,
  businessDaysLate: number,
  daysOpen: number
): number {
  const cancelProb = getCancelProbabilityByDelay(businessDaysLate);
  const v = order.valor;

  switch (order.tipo_excecao) {
    case "atraso_entrega":
      return round2(v * Math.max(cancelProb, 0.04));
    case "rastreio_parado":
      return round2(v * Math.max(cancelProb, daysOpen >= 5 ? 0.28 : 0.16));
    case "extravio":
      return round2(v * 0.96);
    case "vazamento_produto":
      return round2(v * 0.92);
    case "avaria_transporte":
      return round2(v * 0.90);
    case "ruptura_pos_venda":
      return round2(v * 0.88);
    case "falha_personalizacao":
      return round2(v * 0.85);
    case "devolvido_transportadora":
      // Gocase personalizado perde 100% do item se reembolsado pois não volta ao estoque vendável
      return round2(v * (order.marca === "Gocase" ? 0.88 : 0.72));
    case "item_faltante":
      return round2(v * (order.brinde_no_pedido ? 0.45 : 0.76));
    case "endereco_divergente":
      return round2(v * Math.max(0.65, cancelProb));
    case "pagamento_pendente":
      return round2(v * 0.12);
    default:
      return round2(v * 0.5);
  }
}

function selectSafeCarrier(
  order: RawOrder,
  carriersForUf: CarrierRoute[],
  currentCarrierRoute: CarrierRoute,
  activeContainments: ContainmentOrder[]
): { carrier: CarrierRoute; guardNote?: string } {
  const neContained = activeContainments.some(
    (c) => c.active && c.anomalyId === "rota_express_nordeste"
  );
  const cargaNorteContained = activeContainments.some(
    (c) => c.active && c.anomalyId === "carga_norte_lescent_kokeshi"
  );

  // Regra Anti-Reincidência 1: Rota Express no Nordeste -> Veloz Log (+R$ 3,22, mesmo SLA 6d)
  if (
    NORTHEAST_CRITICAL_UFS.has(order.uf) &&
    (order.transportadora === "Rota Express" || neContained)
  ) {
    const veloz = carriersForUf.find((c) => c.transportadora === "Veloz Log");
    if (veloz) {
      return {
        carrier: veloz,
        guardNote: `Redirecionamento logístico NE (${order.uf}): Rota Express -> Veloz Log (mesmo SLA ${veloz.sla_contratado_dias_uteis}d úteis, elimina 64% de atraso)`,
      };
    }
  }

  // Regra Anti-Reincidência 2: Avaria na Carga Norte (especialmente vidro Lescent)
  if (
    (order.tipo_excecao === "avaria_transporte" && order.transportadora === "Carga Norte") ||
    (cargaNorteContained && order.transportadora === "Carga Norte" && order.marca === "Lescent")
  ) {
    const alternatives = carriersForUf
      .filter((c) => c.transportadora !== "Carga Norte" && c.transportadora !== "Rota Express")
      .sort((a, b) => a.custo_medio_frete - b.custo_medio_frete);
    const chosen =
      carriersForUf.find((c) => c.transportadora === "Veloz Log") ??
      alternatives[0] ??
      currentCarrierRoute;
    return {
      carrier: chosen,
      guardNote: `Bloqueio Carga Norte p/ item sensível (${order.marca}): migrado p/ ${chosen.transportadora} + embalagem colmeia dupla`,
    };
  }

  // Em caso de extravio ou rastreio parado, evita repetir a transportadora que falhou se houver opção competitiva
  if (order.tipo_excecao === "extravio" || order.tipo_excecao === "rastreio_parado") {
    const reliable = carriersForUf
      .filter((c) => c.transportadora !== order.transportadora)
      .sort(
        (a, b) =>
          a.sla_contratado_dias_uteis - b.sla_contratado_dias_uteis ||
          a.custo_medio_frete - b.custo_medio_frete
      );
    if (reliable[0]) {
      return {
        carrier: reliable[0],
        guardNote: `Contingência de rota pós-${order.tipo_excecao}: ${order.transportadora} -> ${reliable[0].transportadora} (SLA ${reliable[0].sla_contratado_dias_uteis}d)`,
      };
    }
  }

  return { carrier: currentCarrierRoute };
}

export function calculateOrderEconomics(
  order: RawOrder,
  customer: Customer | undefined,
  carriersForUf: CarrierRoute[],
  activeContainments: ContainmentOrder[] = []
): OrderEconomicsSummary {
  const ltv = calculateCustomerLtvMetrics(customer, order.valor);
  const currentRoute: CarrierRoute =
    carriersForUf.find((c) => c.transportadora === order.transportadora) ?? {
      transportadora: order.transportadora || "Veloz Log",
      uf_atendida: order.uf,
      sla_contratado_dias_uteis: 5,
      custo_medio_frete: 18.0,
    };

  const cmvBRL = round2(CMV_RATE * order.valor);
  const standardReshipCostBRL = round2(cmvBRL + currentRoute.custo_medio_frete);
  const reshipExceedsOrderValue = standardReshipCostBRL > order.valor;

  const { carrier: safeCarrier, guardNote: carrierGuard } = selectSafeCarrier(
    order,
    carriersForUf,
    currentRoute,
    activeContainments
  );

  const guards: string[] = [];
  if (carrierGuard) guards.push(carrierGuard);

  if (order.tipo_excecao === "vazamento_produto" && order.lote_produto === "L2607-B") {
    guards.push(
      "Trava Anti-Reincidência de Lote: PROIBIDO separar do lote L2607-B (SKU APC-1067); puxar lote íntegro auditado (L2608-A/C) + lacre reforçado na tampa"
    );
  }
  if (order.tipo_excecao === "falha_personalizacao" && order.maquina === "IMP-02") {
    guards.push(
      "Trava Anti-Reincidência Industrial: BLOQUEAR reimpressão na IMP-02; rotear ordem para IMP-01 ou IMP-03 (CD1) com inspeção visual pré-expedição"
    );
  }
  if (order.tipo_excecao === "avaria_transporte" && order.marca === "Lescent") {
    guards.push("Proteção Frágil GoBeauté: exigir berço protetor/plástico bolha duplo no frasco de vidro Lescent");
  }
  if (order.tipo_excecao === "item_faltante" && order.cd === "CD2" && order.turno === "noite") {
    guards.push("Auditoria Picking CD2: bipagem obrigatória de SKU + brinde promocional antes do fechamento da caixa");
  }

  // Elegibilidade de ressarcimento junto à transportadora causadora (extravio e avaria em trânsito)
  const eligibleCarrierClaimBRL =
    order.tipo_excecao === "extravio" || order.tipo_excecao === "avaria_transporte"
      ? round2(cmvBRL + currentRoute.custo_medio_frete)
      : 0;

  const safeReshipDirectCost = round2(cmvBRL + safeCarrier.custo_medio_frete);
  const reshipNetImpact = round2(
    Math.max(0, safeReshipDirectCost - eligibleCarrierClaimBRL) + ltv.ltvAtRiskBRL * 0.08
  );

  const reshipOption: ActionOptionQuote = {
    action: "reenvio_prioritario",
    label: "Reenvio Prioritário Anti-Reincidência",
    directCostBRL: safeReshipDirectCost,
    expectedLtvLossBRL: round2(ltv.ltvAtRiskBRL * 0.08),
    carrierRecoveryBRL: eligibleCarrierClaimBRL,
    netImpactBRL: reshipNetImpact,
    recommendedCarrier: safeCarrier.transportadora,
    carrierSlaDays: safeCarrier.sla_contratado_dias_uteis,
    carrierFreightBRL: safeCarrier.custo_medio_frete,
    requiresPhysicalReship: true,
    antiRecurrenceGuards: guards,
    rationale: `Repõe o produto (CMV R$ ${cmvBRL.toFixed(2)} + Frete ${safeCarrier.transportadora} R$ ${safeCarrier.custo_medio_frete.toFixed(2)})${
      eligibleCarrierClaimBRL > 0
        ? ` com abertura de sinistro de R$ ${eligibleCarrierClaimBRL.toFixed(2)} contra ${order.transportadora}`
        : ""
    }, preservando 92% do LTV do cliente.`,
  };

  const reexpeditionDirectCost = round2(safeCarrier.custo_medio_frete);
  const reexpeditionOption: ActionOptionQuote = {
    action: "reexpedicao_sem_cmv",
    label: "Reexpedição Sem Novo CMV (Mesmo Item)",
    directCostBRL: reexpeditionDirectCost,
    expectedLtvLossBRL: round2(ltv.ltvAtRiskBRL * 0.12),
    carrierRecoveryBRL: 0,
    netImpactBRL: round2(reexpeditionDirectCost + ltv.ltvAtRiskBRL * 0.12),
    recommendedCarrier: safeCarrier.transportadora,
    carrierSlaDays: safeCarrier.sla_contratado_dias_uteis,
    carrierFreightBRL: safeCarrier.custo_medio_frete,
    requiresPhysicalReship: true,
    antiRecurrenceGuards: [
      ...guards,
      "Validação ativa de CEP/complemento via WhatsApp antes da nova etiqueta",
    ],
    rationale: `Reaproveita o item íntegro retornado ao CD (CMV R$ 0,00), pagando apenas novo frete (R$ ${reexpeditionDirectCost.toFixed(2)}). Essencial em personalizados Gocase que teriam perda total no reembolso.`,
  };

  // Voucher / Crédito Instantâneo: Frete zero!
  const isFreebieMissing = order.tipo_excecao === "item_faltante" && order.brinde_no_pedido;
  const voucherFaceValue = isFreebieMissing
    ? round2(Math.min(25, Math.max(15, order.valor * 0.18)))
    : round2(order.valor * 1.1);
  // Custo econômico real do voucher na recompra é o CMV da mercadoria futura (24% do face value), sem frete extra avulso
  const voucherEffectiveCost = isFreebieMissing
    ? round2(voucherFaceValue * 0.35)
    : round2(CMV_RATE * voucherFaceValue);

  const voucherOption: ActionOptionQuote = {
    action: "voucher_credito",
    label: isFreebieMissing
      ? `Voucher Instantâneo Brinde (R$ ${voucherFaceValue.toFixed(2)} — Frete Zero)`
      : `Crédito Instantâneo 110% (R$ ${voucherFaceValue.toFixed(2)} — Frete Zero)`,
    directCostBRL: voucherEffectiveCost,
    expectedLtvLossBRL: round2(ltv.ltvAtRiskBRL * 0.18),
    carrierRecoveryBRL: eligibleCarrierClaimBRL,
    netImpactBRL: round2(
      Math.max(0, voucherEffectiveCost - eligibleCarrierClaimBRL) + ltv.ltvAtRiskBRL * 0.18
    ),
    recommendedCarrier: "N/A (Digital)",
    carrierSlaDays: 0,
    carrierFreightBRL: 0,
    requiresPhysicalReship: false,
    antiRecurrenceGuards: isFreebieMissing
      ? ["Evita gastar frete completo (~R$ 18+) apenas para enviar brinde faltante"]
      : ["Converte reembolso em nova compra imediata no catálogo disponível sem custo logístico extra"],
    rationale: isFreebieMissing
      ? `Economiza 100% do frete de reenvio ao converter o brinde faltante em crédito imediato de R$ ${voucherFaceValue.toFixed(2)} (custo efetivo R$ ${voucherEffectiveCost.toFixed(2)}).`
      : `Libera crédito imediato de R$ ${voucherFaceValue.toFixed(2)} (custo CMV futuro R$ ${voucherEffectiveCost.toFixed(2)}, Frete R$ 0,00), retendo receita dentro do ecossistema Gogroup.`,
  };

  const refundOption: ActionOptionQuote = {
    action: "reembolso_direto",
    label: "Reembolso Integral Pix/Cartão",
    directCostBRL: round2(order.valor),
    expectedLtvLossBRL: ltv.ltvAtRiskBRL,
    carrierRecoveryBRL: eligibleCarrierClaimBRL,
    netImpactBRL: round2(
      Math.max(0, order.valor - eligibleCarrierClaimBRL) + ltv.ltvAtRiskBRL
    ),
    recommendedCarrier: "N/A (Estorno)",
    carrierSlaDays: 0,
    carrierFreightBRL: 0,
    requiresPhysicalReship: false,
    antiRecurrenceGuards: [],
    rationale: `Devolve 100% do valor pago (R$ ${order.valor.toFixed(2)}) e expõe perda esperada de LTV de R$ ${ltv.ltvAtRiskBRL.toFixed(2)}.`,
  };

  let recommendedOption: ActionOptionQuote = reshipOption;
  let alternativeOptions: ActionOptionQuote[] = [voucherOption, refundOption];
  let vipProtectionOverride = false;

  // Matriz de decisão determinística por tipo de exceção e Unit Economics
  if (order.tipo_excecao === "devolvido_transportadora" || order.tipo_excecao === "endereco_divergente") {
    recommendedOption = reexpeditionOption;
    alternativeOptions = [voucherOption, refundOption];
  } else if (order.tipo_excecao === "ruptura_pos_venda") {
    // Sem estoque físico do SKU comprado -> Voucher 110% p/ troca imediata de SKU/cor sem perder cliente, ou reembolso
    recommendedOption = voucherOption;
    alternativeOptions = [refundOption, reshipOption];
  } else if (isFreebieMissing) {
    // Item faltante em pedido com brinde -> Voucher digital evita pagar frete de R$ 12–28 por um brinde
    recommendedOption = voucherOption;
    alternativeOptions = [reshipOption, refundOption];
  } else if (reshipExceedsOrderValue) {
    // Os 61 pedidos onde 0.24 * valor + frete > valor!
    const extraReshipCostOverOrder = safeReshipDirectCost - order.valor;
    if (ltv.isVip && ltv.ltvAtRiskBRL > extraReshipCostOverOrder) {
      vipProtectionOverride = true;
      recommendedOption = {
        ...reshipOption,
        label: "Reenvio Prioritário (Proteção VIP Override)",
        rationale: `Embora CMV+Frete (R$ ${safeReshipDirectCost.toFixed(2)}) supere o pedido (R$ ${order.valor.toFixed(2)}), cliente é VIP (R$ ${ltv.accumulatedRevenue.toFixed(2)} acumulados) e o LTV protegido (R$ ${ltv.ltvAtRiskBRL.toFixed(2)}) paga o diferencial.`,
      };
      alternativeOptions = [voucherOption, refundOption];
    } else {
      recommendedOption = voucherOption;
      alternativeOptions = [refundOption, reshipOption];
    }
  } else if (order.tipo_excecao === "atraso_entrega") {
    // Atraso real em trânsito: se atraso moderado (<= 5 dias úteis), retenção ativa c/ voucher + cobrança de prioridade na transportadora evita reenviar duplicado
    const realDue = calculateRealDueDate(order.data_pedido, currentRoute.sla_contratado_dias_uteis);
    const delayDays = countBusinessDaysBetween(realDue, REFERENCE_DATE);
    if (delayDays <= 5) {
      const retentionVoucherVal = round2(Math.min(30, Math.max(15, order.valor * 0.15)));
      const retentionCost = round2(retentionVoucherVal * CMV_RATE);
      recommendedOption = {
        action: "voucher_credito",
        label: `Retenção Proativa + Escalonamento Transportadora (Cupom R$ ${retentionVoucherVal.toFixed(2)})`,
        directCostBRL: retentionCost,
        expectedLtvLossBRL: round2(ltv.ltvAtRiskBRL * 0.1),
        carrierRecoveryBRL: 0,
        netImpactBRL: round2(retentionCost + ltv.ltvAtRiskBRL * 0.1),
        recommendedCarrier: currentRoute.transportadora,
        carrierSlaDays: currentRoute.sla_contratado_dias_uteis,
        carrierFreightBRL: 0,
        requiresPhysicalReship: false,
        antiRecurrenceGuards: [
          `Acionamento prioritário de rota junto à ${currentRoute.transportadora} antes do cliff de cancelamento`,
        ],
        rationale: `Pedido já despachado com ${delayDays}d úteis de atraso: escalonar entrega + cupom de pedido de desculpas (custo CMV R$ ${retentionCost.toFixed(2)}) evita estorno de R$ ${order.valor.toFixed(2)} sem duplicar frete.`,
      };
      alternativeOptions = [reshipOption, refundOption];
    }
  }

  return {
    cmvBRL,
    currentCarrierFreightBRL: currentRoute.custo_medio_frete,
    currentCarrierSlaDays: currentRoute.sla_contratado_dias_uteis,
    standardReshipCostBRL,
    refundCostBRL: round2(order.valor),
    reshipExceedsOrderValue,
    vipProtectionOverride,
    eligibleCarrierClaimBRL,
    recommendedOption,
    alternativeOptions,
  };
}

/**
 * Trava Tripla de Consolidação de Frete:
 * Em carteiras com múltiplos pedidos, só unifica caixa física se:
 * 1) Mesmo CD + 2) Mesma UF e cidade + 3) Ambos com ação de reenvio físico.
 */
function resolveChosenQuote(
  order: EnrichedOrder,
  chosenActions?: Record<string, RecommendedActionType>
): ActionOptionQuote {
  const act = chosenActions?.[order.order_id];
  if (!act) return order.economics.recommendedOption;
  const all = [
    order.economics.recommendedOption,
    ...order.economics.alternativeOptions,
  ];
  return (
    all.find((q) => q.action === act) ?? order.economics.recommendedOption
  );
}

export function checkTripleFreightLock(
  orders: EnrichedOrder[],
  chosenActions?: Record<string, RecommendedActionType>
): boolean {
  const reshipOrders = orders.filter(
    (o) => resolveChosenQuote(o, chosenActions).requiresPhysicalReship
  );
  if (reshipOrders.length < 2) return false;
  const first = reshipOrders[0];
  return reshipOrders.every(
    (o) => o.cd === first.cd && o.uf === first.uf && o.cidade === first.cidade
  );
}

/**
 * Calcula a economia de frete por consolidação física agrupando por CD + UF + Cidade,
 * respeitando a ação efetivamente selecionada (ex.: se virou Voucher/Reembolso, não há caixa física).
 */
export function calculateFreightConsolidationSavings(
  orders: EnrichedOrder[],
  chosenActions?: Record<string, RecommendedActionType>
): number {
  const groups = new Map<string, ActionOptionQuote[]>();
  for (const o of orders) {
    const quote = resolveChosenQuote(o, chosenActions);
    if (!quote.requiresPhysicalReship) continue;
    const key = `${o.cd}|${o.uf}|${o.cidade}`;
    const list = groups.get(key) ?? [];
    list.push(quote);
    groups.set(key, list);
  }
  let savings = 0;
  for (const list of groups.values()) {
    if (list.length >= 2) {
      savings += list
        .slice(1)
        .reduce((acc, q) => acc + q.carrierFreightBRL, 0);
    }
  }
  return round2(savings);
}

export function buildOrderRecordFromRaw(
  raw: RawOrder,
  carriersByUfAndName: Map<string, CarrierRoute>,
  source: "seed" | "manual" | "csv_upload" = "seed",
  referenceDate: string = REFERENCE_DATE
): OrderRecord {
  const carrier = carriersByUfAndName.get(`${raw.transportadora}|${raw.uf}`);
  const sla = carrier?.sla_contratado_dias_uteis ?? 5;
  const realDueDate = calculateRealDueDate(raw.data_pedido, sla);
  const auto = classifyAutoTriage(raw, realDueDate, referenceDate);

  return {
    ...raw,
    workflowStatus: auto.category === "none" ? "active_queue" : "auto_triaged",
    autoTriageCategory: auto.category,
    autoTriageNote: auto.note || undefined,
    source,
  };
}

export function enrichOrderRecord(
  record: OrderRecord,
  customer: Customer | undefined,
  carriersByUf: Map<string, CarrierRoute[]>,
  activeContainments: ContainmentOrder[] = [],
  referenceDate: string = REFERENCE_DATE
): EnrichedOrder {
  const carriersForUf = carriersByUf.get(record.uf) ?? [];
  const currentRoute = carriersForUf.find((c) => c.transportadora === record.transportadora);
  const sla = currentRoute?.sla_contratado_dias_uteis ?? 5;

  const realDueDate = calculateRealDueDate(record.data_pedido, sla);
  const calendarBugDetected = Boolean(record.data_prometida && record.data_prometida < realDueDate);
  const effectiveRefDate = record.data_entrega || referenceDate;
  const businessDaysLate = record.data_entrega
    ? countBusinessDaysBetween(realDueDate, record.data_entrega)
    : countBusinessDaysBetween(realDueDate, referenceDate);
  const daysOpen = countCalendarDaysBetween(record.data_abertura_excecao, effectiveRefDate);
  const cancelProbability = record.data_entrega ? 0 : getCancelProbabilityByDelay(businessDaysLate);
  const cliff = record.data_entrega
    ? { nextCliffDaysLeft: null, deltaProb: 0 }
    : getMarginalDelayCliff(businessDaysLate, realDueDate, referenceDate);

  const marginalCliffBRL = round2(record.valor * cliff.deltaProb);
  const directOrderRiskBRL =
    record.workflowStatus === "auto_triaged"
      ? 0
      : calculateDirectOrderRisk(record, businessDaysLate, daysOpen);

  const ltv = calculateCustomerLtvMetrics(customer, record.valor);
  const anomalyFlags = detectOrderAnomalyFlags(record, realDueDate);
  const economics = calculateOrderEconomics(record, customer, carriersForUf, activeContainments);

  return {
    ...record,
    realDueDate,
    calendarBugDetected,
    businessDaysLate,
    daysOpen,
    cancelProbability,
    nextCliffDaysLeft: cliff.nextCliffDaysLeft,
    marginalCliffBRL,
    directOrderRiskBRL,
    isVipCustomer: ltv.isVip,
    customerAccumulatedRevenue: ltv.accumulatedRevenue,
    customerOrderCount: ltv.orderCount,
    customerTicketAverage: ltv.ticketAverage,
    customerLtvAtRiskSingleBRL: ltv.ltvAtRiskBRL,
    anomalyFlags,
    requiresPhysicalReship: economics.recommendedOption.requiresPhysicalReship,
    economics,
  };
}
