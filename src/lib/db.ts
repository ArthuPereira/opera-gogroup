import Dexie, { type Table } from "dexie";
import { buildOrderRecordFromRaw, round2 } from "./business-rules";
import {
  AuditLogEntry,
  CarrierClaim,
  CarrierRoute,
  ContainmentOrder,
  Customer,
  EnrichedOrder,
  OrderRecord,
  PortfolioResolutionPlan,
  RawOrder,
  RecommendedActionType,
  SystemicContainmentPlan,
} from "./types";

export class OperaGogroupDB extends Dexie {
  orders!: Table<OrderRecord, string>;
  customers!: Table<Customer, string>;
  carriers!: Table<CarrierRoute, string>;
  containments!: Table<ContainmentOrder, string>;
  claims!: Table<CarrierClaim, string>;
  auditLogs!: Table<AuditLogEntry, number>;

  constructor() {
    super("OperaGogroupCentralDB_v1");
    this.version(1).stores({
      orders:
        "order_id, customer_id, workflowStatus, autoTriageCategory, tipo_excecao, marca, transportadora, uf, cd",
      customers: "customer_id, receita_acumulada",
      carriers: "id, transportadora, uf_atendida",
      containments: "id, anomalyId, active",
      claims: "claim_id, order_id, transportadora, tipo_ocorrencia",
      auditLogs: "++id, timestamp, actor",
    });
  }
}

export const db = new OperaGogroupDB();

let seedInFlight: Promise<void> | null = null;

export async function ensureDatabaseSeeded(forceReset = false): Promise<void> {
  if (typeof window === "undefined") return;

  if (!forceReset) {
    const existingCount = await db.orders.count();
    if (existingCount > 0) return;
  }

  if (seedInFlight) return seedInFlight;

  seedInFlight = (async () => {
    try {
      const res = await fetch("/api/seed", { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Erro HTTP ${res.status} ao carregar base inicial`);
      }
      const data = (await res.json()) as {
        orders: RawOrder[];
        customers: Customer[];
        carriers: CarrierRoute[];
      };

      const carriersWithId: CarrierRoute[] = data.carriers.map((c) => ({
        ...c,
        id: `${c.transportadora}|${c.uf_atendida}`,
      }));

      const carrierMap = new Map<string, CarrierRoute>();
      for (const c of carriersWithId) {
        carrierMap.set(c.id!, c);
      }

      const orderRecords: OrderRecord[] = data.orders.map((raw) =>
        buildOrderRecordFromRaw(raw, carrierMap, "seed")
      );

      const autoEncerrados = orderRecords.filter(
        (o) => o.autoTriageCategory === "auto_encerrado_entregue"
      ).length;
      const autoPix = orderRecords.filter(
        (o) => o.autoTriageCategory === "auto_cobranca_pix"
      ).length;
      const autoFalsoAtraso = orderRecords.filter(
        (o) => o.autoTriageCategory === "auto_aviso_falso_atraso"
      ).length;
      const totalAuto = autoEncerrados + autoPix + autoFalsoAtraso;

      await db.transaction(
        "rw",
        [db.orders, db.customers, db.carriers, db.containments, db.claims, db.auditLogs],
        async () => {
          await Promise.all([
            db.orders.clear(),
            db.customers.clear(),
            db.carriers.clear(),
            db.containments.clear(),
            db.claims.clear(),
            db.auditLogs.clear(),
          ]);

          await db.carriers.bulkPut(carriersWithId);
          await db.customers.bulkPut(data.customers);
          await db.orders.bulkPut(orderRecords);

          await db.auditLogs.add({
            timestamp: new Date().toISOString(),
            actor: "motor_deterministico",
            actionTitle: `Triagem automática concluída (${totalAuto} pedidos)`,
            targetIds: orderRecords
              .filter((o) => o.workflowStatus === "auto_triaged")
              .slice(0, 12)
              .map((o) => o.order_id),
            financialImpactBRL: round2(totalAuto * 9.0),
            details: `Já entregues: ${autoEncerrados} • Pix 24h: ${autoPix} • No prazo real: ${autoFalsoAtraso}.`,
          });
        }
      );
    } finally {
      seedInFlight = null;
    }
  })();

  return seedInFlight;
}

export async function ingestNewOrders(
  rawOrders: RawOrder[],
  source: "manual" | "csv_upload"
): Promise<{ totalAdded: number; autoTriaged: number; activeAdded: number }> {
  const allCarriers = await db.carriers.toArray();
  const carrierMap = new Map<string, CarrierRoute>();
  for (const c of allCarriers) {
    carrierMap.set(`${c.transportadora}|${c.uf_atendida}`, c);
  }

  const records = rawOrders.map((raw) =>
    buildOrderRecordFromRaw(raw, carrierMap, source)
  );

  // Deduplica por order_id mantendo a última ocorrência caso o CSV repita o mesmo pedido
  const dedupMap = new Map<string, OrderRecord>();
  for (const r of records) {
    dedupMap.set(r.order_id, r);
  }
  const uniqueRecords = Array.from(dedupMap.values());

  const autoTriaged = uniqueRecords.filter(
    (r) => r.workflowStatus === "auto_triaged"
  ).length;
  const activeAdded = uniqueRecords.length - autoTriaged;

  await db.transaction("rw", [db.orders, db.customers, db.auditLogs], async () => {
    const existingOrders = await db.orders.bulkGet(
      uniqueRecords.map((r) => r.order_id)
    );
    const existingOrderIds = new Set(
      existingOrders.filter((o): o is OrderRecord => Boolean(o)).map((o) => o.order_id)
    );

    const customerDeltas = new Map<
      string,
      { addCount: number; addRevenue: number; firstDate: string }
    >();
    for (const r of uniqueRecords) {
      if (existingOrderIds.has(r.order_id)) continue;
      const cur = customerDeltas.get(r.customer_id) ?? {
        addCount: 0,
        addRevenue: 0,
        firstDate: r.data_pedido,
      };
      cur.addCount += 1;
      cur.addRevenue = round2(cur.addRevenue + r.valor);
      if (r.data_pedido < cur.firstDate) cur.firstDate = r.data_pedido;
      customerDeltas.set(r.customer_id, cur);
    }

    for (const [cid, delta] of customerDeltas.entries()) {
      const exists = await db.customers.get(cid);
      if (!exists) {
        await db.customers.put({
          customer_id: cid,
          n_pedidos: delta.addCount,
          receita_acumulada: delta.addRevenue,
          data_primeiro_pedido: delta.firstDate,
          n_contatos_atendimento: 1,
        });
      } else {
        await db.customers.update(cid, {
          n_pedidos: exists.n_pedidos + delta.addCount,
          receita_acumulada: round2(exists.receita_acumulada + delta.addRevenue),
        });
      }
    }

    await db.orders.bulkPut(uniqueRecords);

    await db.auditLogs.add({
      timestamp: new Date().toISOString(),
      actor: "motor_deterministico",
      actionTitle:
        source === "manual"
          ? `Novo pedido (${uniqueRecords[0]?.order_id})`
          : `Importação CSV (${uniqueRecords.length} pedidos)`,
      targetIds: uniqueRecords.slice(0, 10).map((r) => r.order_id),
      financialImpactBRL: round2(autoTriaged * 9.0),
      details: `${autoTriaged} resolvido(s) na triagem • ${activeAdded} enviado(s) para a fila.`,
    });
  });

  return { totalAdded: uniqueRecords.length, autoTriaged, activeAdded };
}

export async function revertAutoTriagedOrderToHumanQueue(orderId: string): Promise<void> {
  const order = await db.orders.get(orderId);
  if (!order) return;
  const previousCategory = order.autoTriageCategory;

  await db.transaction("rw", [db.orders, db.auditLogs], async () => {
    await db.orders.update(orderId, {
      workflowStatus: "active_queue",
      autoTriageCategory: "none",
      manualOverrideFromAuto: true,
      status: "em_analise",
    });

    await db.auditLogs.add({
      timestamp: new Date().toISOString(),
      actor: "operador_manual",
      actionTitle: `Reversão de Triagem para Fila (${orderId})`,
      targetIds: [orderId],
      financialImpactBRL: 0,
      details: `Pedido ${orderId} (regra anterior: ${previousCategory}) movido manualmente para a fila de tratativas.`,
    });
  });
}

export async function executePortfolioResolution(params: {
  customerId: string;
  enrichedOrders: EnrichedOrder[];
  portfolioTotalOrdersCount?: number;
  plan?: PortfolioResolutionPlan | null;
  actionOverrides?: Record<string, RecommendedActionType>;
  customMessage?: string;
}): Promise<{ resolvedCount: number; totalSavingsBRL: number; claimsOpened: number }> {
  const {
    customerId,
    enrichedOrders,
    portfolioTotalOrdersCount,
    plan,
    actionOverrides = {},
    customMessage,
  } = params;
  const nowIso = new Date().toISOString();
  const batchId = `${customerId}-${Date.now()}`;
  const ltvDivisor = Math.max(
    1,
    portfolioTotalOrdersCount ?? enrichedOrders.length,
    enrichedOrders.length
  );

  let totalSavingsBRL = 0;
  let claimsOpened = 0;
  const newClaims: CarrierClaim[] = [];
  const updatedOrders: OrderRecord[] = [];
  const seenBoxKeys = new Set<string>();

  for (const order of enrichedOrders) {
    const agentDecision = plan?.decisions.find((d) => d.order_id === order.order_id);
    const chosenAction: RecommendedActionType =
      actionOverrides[order.order_id] ??
      agentDecision?.recommendedAction ??
      order.economics.recommendedOption.action;

    const allQuotes = [
      order.economics.recommendedOption,
      ...order.economics.alternativeOptions,
    ];
    const matchedQuote =
      allQuotes.find((q) => q.action === chosenAction) ??
      order.economics.recommendedOption;

    // Aplica desconto real de consolidação de caixa para o 2º+ envio físico no mesmo CD/UF/cidade
    let freightDiscount = 0;
    if (matchedQuote.requiresPhysicalReship) {
      const boxKey = `${order.cd}|${order.uf}|${order.cidade}`;
      if (seenBoxKeys.has(boxKey)) {
        freightDiscount = matchedQuote.carrierFreightBRL;
      } else {
        seenBoxKeys.add(boxKey);
      }
    }

    const effectiveDirectCost = round2(
      Math.max(0, matchedQuote.directCostBRL - freightDiscount)
    );
    const effectiveNetImpact = round2(
      Math.max(0, matchedQuote.netImpactBRL - freightDiscount)
    );

    // Economia gerada = exposição evitada (risco direto + cliff + LTV rateado pelo total da carteira) menos impacto líquido
    const worstCaseLoss = round2(
      order.directOrderRiskBRL +
        order.marginalCliffBRL +
        order.customerLtvAtRiskSingleBRL / ltvDivisor
    );
    const savings = round2(
      Math.max(8, worstCaseLoss - effectiveNetImpact * 0.35 + freightDiscount)
    );
    totalSavingsBRL = round2(totalSavingsBRL + savings);

    let claimId: string | undefined;
    if (
      order.economics.eligibleCarrierClaimBRL > 0 &&
      (order.tipo_excecao === "extravio" ||
        order.tipo_excecao === "avaria_transporte") &&
      agentDecision?.openCarrierClaim !== false
    ) {
      claimId = `SIN-${order.order_id}`;
      claimsOpened++;
      newClaims.push({
        claim_id: claimId,
        order_id: order.order_id,
        customer_id: order.customer_id,
        transportadora: order.transportadora,
        uf: order.uf,
        tipo_ocorrencia: order.tipo_excecao,
        marca: order.marca,
        sku: order.sku,
        valor_pedido: order.valor,
        valor_reclamado_brl: order.economics.eligibleCarrierClaimBRL,
        status_sinistro: "protocolado",
        evidencia_tecnica:
          order.tipo_excecao === "extravio"
            ? `Pacote sem movimentação confirmada / extraviado na malha ${order.transportadora} (${order.uf}). Ressarcimento de CMV + frete original.`
            : `Avaria física registrada na entrega via ${order.transportadora} (${order.marca} - ${order.sku}). Cobrança contratual de CMV + frete.`,
        createdAt: nowIso,
      });
    }

    const {
      // Strip computed fields before persisting back to Dexie
      realDueDate: _r1,
      calendarBugDetected: _r2,
      businessDaysLate: _r3,
      daysOpen: _r4,
      cancelProbability: _r5,
      nextCliffDaysLeft: _r6,
      marginalCliffBRL: _r7,
      directOrderRiskBRL: _r8,
      isVipCustomer: _r9,
      customerAccumulatedRevenue: _r10,
      customerOrderCount: _r11,
      customerTicketAverage: _r12,
      customerLtvAtRiskSingleBRL: _r13,
      anomalyFlags: _r14,
      requiresPhysicalReship: _r15,
      economics: _r16,
      ...baseRecord
    } = order;

    updatedOrders.push({
      ...baseRecord,
      workflowStatus: "resolved",
      status: "resolvida",
      resolvedAction: chosenAction,
      resolvedCarrier:
        chosenAction === agentDecision?.recommendedAction &&
        agentDecision?.targetCarrier
          ? agentDecision.targetCarrier
          : matchedQuote.recommendedCarrier,
      resolvedNote:
        customMessage ||
        plan?.executiveSummary ||
        matchedQuote.rationale,
      resolvedSavingsBRL: savings,
      resolvedCostBRL: effectiveDirectCost,
      resolvedAt: nowIso,
      resolutionBatchId: batchId,
      claimId,
    });
  }

  // Soma economia de contatos de SAC evitados no agrupamento
  const groupedSacBonus = round2(Math.max(0, enrichedOrders.length - 1) * 9.0);
  totalSavingsBRL = round2(totalSavingsBRL + groupedSacBonus);

  await db.transaction(
    "rw",
    [db.orders, db.claims, db.auditLogs],
    async () => {
      await db.orders.bulkPut(updatedOrders);
      if (newClaims.length > 0) {
        await db.claims.bulkPut(newClaims);
      }
      await db.auditLogs.add({
        timestamp: nowIso,
        actor: plan ? "agente_ia_aprovado" : "operador_manual",
        actionTitle: `Carteira ${customerId} Resolvida em 1 Tratativa (${updatedOrders.length} pedido${
          updatedOrders.length > 1 ? "s" : ""
        })`,
        targetIds: updatedOrders.map((o) => o.order_id),
        financialImpactBRL: totalSavingsBRL,
        details: `${updatedOrders
          .map((o) => `${o.order_id}: ${o.resolvedAction} (${o.resolvedCarrier})`)
          .join(" • ")}${
          newClaims.length > 0
            ? ` • ${newClaims.length} protocolo(s) de ressarcimento aberto(s) (R$ ${newClaims
                .reduce((a, c) => a + c.valor_reclamado_brl, 0)
                .toFixed(2)})`
            : ""
        }`,
        reversibleOrderIds: updatedOrders.map((o) => o.order_id),
      });
    }
  );

  return {
    resolvedCount: updatedOrders.length,
    totalSavingsBRL,
    claimsOpened,
  };
}

export async function activateSystemicContainment(
  plan: SystemicContainmentPlan
): Promise<void> {
  const nowIso = new Date().toISOString();
  const order: ContainmentOrder = {
    id: plan.anomalyId,
    anomalyId: plan.anomalyId,
    title: plan.title,
    active: true,
    activatedAt: nowIso,
    ruleSummary: plan.ruleSummary,
    technicalDispatch: plan.technicalDispatchMessage,
    blockedTarget: plan.blockedTarget,
    redirectTarget: plan.redirectTarget,
    estimatedMonthlySavingsBRL: plan.estimatedSavingsBRL,
    generatedByAgent: plan.modelUsed !== "motor-deterministico-local",
  };

  await db.transaction("rw", [db.containments, db.auditLogs], async () => {
    await db.containments.put(order);
    await db.auditLogs.add({
      timestamp: nowIso,
      actor: "radar_sistemico",
      actionTitle: `Ordem de Contenção Sistêmica Ativada: ${plan.title}`,
      targetIds: [plan.anomalyId],
      financialImpactBRL: plan.estimatedSavingsBRL,
      details: `Bloqueio: ${plan.blockedTarget} -> Redirecionamento: ${plan.redirectTarget}. Regra ativa para todas as próximas decisões na fila.`,
    });
  });
}

export async function toggleContainmentActive(
  anomalyId: string,
  active: boolean
): Promise<void> {
  await db.containments.update(anomalyId, { active });
}
