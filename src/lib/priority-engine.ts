import {
  calculateFreightConsolidationSavings,
  checkTripleFreightLock,
  round2,
  SAC_CONTACT_COST_BRL,
} from "./business-rules";
import {
  Customer,
  CustomerPortfolio,
  EnrichedOrder,
  ExceptionType,
  QueueSimulationComparison,
} from "./types";

export const DAILY_HUMAN_CAPACITY = 150;
export const MINUTES_PER_TREATMENT = 12;

export function buildCustomerPortfolios(
  activeOrders: EnrichedOrder[],
  customersMap: Map<string, Customer>
): CustomerPortfolio[] {
  const byCustomer = new Map<string, EnrichedOrder[]>();

  for (const order of activeOrders) {
    if (order.workflowStatus !== "active_queue") continue;
    const list = byCustomer.get(order.customer_id);
    if (list) {
      list.push(order);
    } else {
      byCustomer.set(order.customer_id, [order]);
    }
  }

  const portfolios: CustomerPortfolio[] = [];

  for (const [customerId, orders] of byCustomer.entries()) {
    // Ordena pedidos internos do cliente pelo maior risco individual primeiro
    const sortedOrders = [...orders].sort(
      (a, b) =>
        b.directOrderRiskBRL +
        b.marginalCliffBRL -
        (a.directOrderRiskBRL + a.marginalCliffBRL)
    );

    const first = sortedOrders[0];
    const customer: Customer = customersMap.get(customerId) ?? {
      customer_id: customerId,
      n_pedidos: first.customerOrderCount,
      receita_acumulada: first.customerAccumulatedRevenue,
      data_primeiro_pedido: first.data_pedido,
      n_contatos_atendimento: 1,
    };

    const totalOrderValueBRL = round2(
      sortedOrders.reduce((acc, o) => acc + o.valor, 0)
    );
    const directOrderRiskBRL = round2(
      sortedOrders.reduce((acc, o) => acc + o.directOrderRiskBRL, 0)
    );
    const marginalCliffBRL = round2(
      sortedOrders.reduce((acc, o) => acc + o.marginalCliffBRL, 0)
    );

    // LTV do cliente contabilizado 1 ÚNICA VEZ por carteira (sem duplicar em múltiplos pedidos)
    const customerLtvRiskBRL = first.customerLtvAtRiskSingleBRL;

    // Economia de contatos de SAC evitados ao consolidar múltiplos pedidos num único atendimento (R$ 9,00/pedido extra)
    const avoidedSacContactsBRL = round2(
      Math.max(0, sortedOrders.length - 1) * SAC_CONTACT_COST_BRL
    );

    const canConsolidatePhysicalBox = checkTripleFreightLock(sortedOrders);
    const freightConsolidationSavingsBRL =
      calculateFreightConsolidationSavings(sortedOrders);

    const riskTotalBRL = round2(
      directOrderRiskBRL +
        marginalCliffBRL +
        customerLtvRiskBRL +
        avoidedSacContactsBRL
    );

    const earliestExceptionDate = sortedOrders.reduce(
      (min, o) => (o.data_abertura_excecao < min ? o.data_abertura_excecao : min),
      sortedOrders[0].data_abertura_excecao
    );

    const brands = Array.from(new Set(sortedOrders.map((o) => o.marca)));
    const exceptionTypes = Array.from(
      new Set(sortedOrders.map((o) => o.tipo_excecao))
    ) as ExceptionType[];
    const anomalyBadges = Array.from(
      new Set(sortedOrders.flatMap((o) => o.anomalyFlags))
    );

    const reasons: string[] = [];
    if (sortedOrders.length > 1) {
      reasons.push(`${sortedOrders.length} pedidos agrupados`);
    }
    if (first.isVipCustomer) {
      reasons.push(`VIP (R$ ${customer.receita_acumulada.toFixed(0)} hist.)`);
    }
    if (marginalCliffBRL > 0) {
      reasons.push(`Cliff iminente (+R$ ${marginalCliffBRL.toFixed(0)})`);
    }
    if (canConsolidatePhysicalBox) {
      reasons.push("Caixa Única Consolidável");
    }
    if (reasons.length === 0) {
      reasons.push(`Exposição R$ ${directOrderRiskBRL.toFixed(0)}`);
    }

    portfolios.push({
      customer_id: customerId,
      customer,
      isVip: first.isVipCustomer,
      orders: sortedOrders,
      orderCount: sortedOrders.length,
      totalOrderValueBRL,
      directOrderRiskBRL,
      marginalCliffBRL,
      customerLtvRiskBRL,
      avoidedSacContactsBRL,
      freightConsolidationSavingsBRL,
      riskTotalBRL,
      canConsolidatePhysicalBox,
      earliestExceptionDate,
      brands,
      exceptionTypes,
      anomalyBadges,
      topPriorityReason: reasons.join(" • "),
    });
  }

  return portfolios.sort((a, b) => {
    if (b.riskTotalBRL !== a.riskTotalBRL) {
      return b.riskTotalBRL - a.riskTotalBRL;
    }
    if (a.earliestExceptionDate !== b.earliestExceptionDate) {
      return a.earliestExceptionDate.localeCompare(b.earliestExceptionDate);
    }
    return a.customer_id.localeCompare(b.customer_id);
  });
}

/**
 * Compara o modelo legado FIFO (150 pedidos mais antigos por data_abertura_excecao, sem auto-triagem e sem agrupar cliente)
 * contra a Central AI-First (Auto-Triagem Zero-Toque + Top 150 Carteiras por R$ em Risco).
 */
export function compareAiFirstVsFifo(
  allOrders: EnrichedOrder[],
  portfolios: CustomerPortfolio[],
  dailyCapacity: number = DAILY_HUMAN_CAPACITY
): QueueSimulationComparison {
  const autoTriagedOrders = allOrders.filter(
    (o) => o.workflowStatus === "auto_triaged"
  );

  // Fila bruta como chegaria hoje na operação manual (ativos + auto-triados que antes ocupavam fila)
  const legacyRawPool = allOrders
    .filter((o) => o.workflowStatus !== "resolved")
    .sort((a, b) => {
      if (a.data_abertura_excecao !== b.data_abertura_excecao) {
        return a.data_abertura_excecao.localeCompare(b.data_abertura_excecao);
      }
      return a.order_id.localeCompare(b.order_id);
    });

  const fifoSlice = legacyRawPool.slice(0, dailyCapacity);
  const fifoActiveOnly = fifoSlice.filter(
    (o) => o.workflowStatus === "active_queue"
  );
  const fifoWastedAutoTriagedSlots = fifoSlice.length - fifoActiveOnly.length;

  // No FIFO, LTV só é protegido quando TODOS os pedidos abertos daquele cliente foram resolvidos no lote do dia
  const activeCountByCustomer = new Map<string, number>();
  for (const o of allOrders) {
    if (o.workflowStatus === "active_queue") {
      activeCountByCustomer.set(
        o.customer_id,
        (activeCountByCustomer.get(o.customer_id) ?? 0) + 1
      );
    }
  }
  const fifoResolvedByCustomer = new Map<string, EnrichedOrder[]>();
  for (const o of fifoActiveOnly) {
    const list = fifoResolvedByCustomer.get(o.customer_id) ?? [];
    list.push(o);
    fifoResolvedByCustomer.set(o.customer_id, list);
  }

  let fifoLtvProtected = 0;
  for (const [cid, list] of fifoResolvedByCustomer.entries()) {
    if (list.length === (activeCountByCustomer.get(cid) ?? 0)) {
      fifoLtvProtected += list[0].customerLtvAtRiskSingleBRL;
    }
  }

  const fifoDirectRisk = fifoActiveOnly.reduce(
    (acc, o) => acc + o.directOrderRiskBRL + o.marginalCliffBRL,
    0
  );
  const fifoRiskProtectedBRL = round2(fifoDirectRisk + fifoLtvProtected);
  const fifoValueCoveredBRL = round2(
    fifoActiveOnly.reduce((acc, o) => acc + o.valor, 0)
  );

  // AI-First: Top 150 carteiras por R$ em Risco
  const topPortfolios = portfolios.slice(0, dailyCapacity);
  const aiFirstOrdersUnlocked = topPortfolios.reduce(
    (acc, p) => acc + p.orderCount,
    0
  );
  const aiFirstRiskProtectedBRL = round2(
    topPortfolios.reduce((acc, p) => acc + p.riskTotalBRL, 0)
  );
  const aiFirstValueCoveredBRL = round2(
    topPortfolios.reduce((acc, p) => acc + p.totalOrderValueBRL, 0)
  );

  const orderMultiplierVsFifo =
    fifoActiveOnly.length > 0
      ? round2(aiFirstOrdersUnlocked / fifoActiveOnly.length)
      : aiFirstOrdersUnlocked;

  const autoTriagedHoursSaved = round2(
    (autoTriagedOrders.length * MINUTES_PER_TREATMENT) / 60
  );

  return {
    dailyCapacityTreatments: dailyCapacity,
    aiFirstPortfoliosHandled: topPortfolios.length,
    aiFirstOrdersUnlocked,
    aiFirstRiskProtectedBRL,
    aiFirstValueCoveredBRL,
    fifoOrdersHandled: fifoSlice.length,
    fifoActiveOrdersUnlocked: fifoActiveOnly.length,
    fifoWastedAutoTriagedSlots,
    fifoRiskProtectedBRL,
    fifoValueCoveredBRL,
    orderMultiplierVsFifo,
    extraRiskProtectedBRL: round2(aiFirstRiskProtectedBRL - fifoRiskProtectedBRL),
    autoTriagedTotal: autoTriagedOrders.length,
    autoTriagedHoursSaved,
  };
}
