"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  CheckCircle2,
  Layers,
  Loader2,
  Radar,
  ShieldCheck,
} from "lucide-react";
import { detectSystemicAnomalies } from "@/lib/anomalies";
import { enrichOrderRecord, round2 } from "@/lib/business-rules";
import { serializeEnrichedOrdersCsv } from "@/lib/csv-io";
import {
  activateSystemicContainment,
  db,
  ensureDatabaseSeeded,
  executePortfolioResolution,
  ingestNewOrders,
  revertAutoTriagedOrderToHumanQueue,
  toggleContainmentActive,
} from "@/lib/db";
import { formatBRL } from "@/lib/format";
import {
  buildCustomerPortfolios,
  compareAiFirstVsFifo,
  DAILY_HUMAN_CAPACITY,
} from "@/lib/priority-engine";
import {
  CarrierRoute,
  Customer,
  CustomerPortfolio,
  PortfolioResolutionPlan,
  RawOrder,
  RecommendedActionType,
  SystemicContainmentPlan,
} from "@/lib/types";
import { AutoTriageAuditTab } from "@/components/AutoTriageAuditTab";
import { IngestModal } from "@/components/IngestModal";
import { KpiHeader } from "@/components/KpiHeader";
import {
  QueueFiltersState,
  SmartQueueTab,
} from "@/components/SmartQueueTab";
import { SystemicRadarTab } from "@/components/SystemicRadarTab";

type MainTab = "queue" | "radar" | "audit";

export default function OperaCentralPage() {
  const [activeTab, setActiveTab] = useState<MainTab>("queue");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [isIngestOpen, setIsIngestOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null
  );
  const [cachedPlans, setCachedPlans] = useState<
    Record<string, PortfolioResolutionPlan>
  >({});

  const [filters, setFilters] = useState<QueueFiltersState>({
    search: "",
    scope: "top150",
    viewMode: "portfolio",
    marca: "all",
    tipoExcecao: "all",
    cd: "all",
    transportadora: "all",
    onlyVip: false,
    onlyMultiOrder: false,
  });

  useEffect(() => {
    let mounted = true;
    ensureDatabaseSeeded(false)
      .catch((err) => {
        if (mounted) {
          setBootError(
            err instanceof Error
              ? err.message
              : "Falha ao inicializar banco local."
          );
        }
      })
      .finally(() => {
        if (mounted) setIsBootstrapping(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const rawOrders = useLiveQuery(() => db.orders.toArray(), []);
  const customers = useLiveQuery(() => db.customers.toArray(), []);
  const carriers = useLiveQuery(() => db.carriers.toArray(), []);
  const containments = useLiveQuery(() => db.containments.toArray(), []);
  const claims = useLiveQuery(
    () => db.claims.orderBy("claim_id").reverse().toArray(),
    []
  );
  const auditLogs = useLiveQuery(
    () => db.auditLogs.orderBy("id").reverse().limit(60).toArray(),
    []
  );

  const computed = useMemo(() => {
    if (!rawOrders || !customers || !carriers || !containments) {
      return null;
    }

    const customersMap = new Map<string, Customer>();
    for (const c of customers) {
      customersMap.set(c.customer_id, c);
    }

    const carriersByUf = new Map<string, CarrierRoute[]>();
    for (const c of carriers) {
      const list = carriersByUf.get(c.uf_atendida) ?? [];
      list.push(c);
      carriersByUf.set(c.uf_atendida, list);
    }

    const enrichedOrders = rawOrders.map((rec) =>
      enrichOrderRecord(
        rec,
        customersMap.get(rec.customer_id),
        carriersByUf,
        containments
      )
    );

    const activeEnriched = enrichedOrders.filter(
      (o) => o.workflowStatus === "active_queue"
    );
    const autoTriagedOrders = enrichedOrders.filter(
      (o) => o.workflowStatus === "auto_triaged"
    );
    const resolvedOrders = enrichedOrders.filter(
      (o) => o.workflowStatus === "resolved"
    );

    const allPortfolios = buildCustomerPortfolios(activeEnriched, customersMap);
    const simulation = compareAiFirstVsFifo(
      enrichedOrders,
      allPortfolios,
      DAILY_HUMAN_CAPACITY
    );
    const anomalies = detectSystemicAnomalies(enrichedOrders, containments);

    const totalActiveExposureBRL = round2(
      allPortfolios.reduce((acc, p) => acc + p.riskTotalBRL, 0)
    );
    const totalOrderValueActiveBRL = round2(
      activeEnriched.reduce((acc, o) => acc + o.valor, 0)
    );

    // Economia total protegida = auto-triagem contatos evitados + economias das resoluções aprovadas
    const resolvedSavings = resolvedOrders.reduce(
      (acc, o) => acc + (o.resolvedSavingsBRL ?? 0),
      0
    );
    const totalProtectedSavingsBRL = round2(
      autoTriagedOrders.length * 9.0 + resolvedSavings
    );

    const resolvedTreatmentsCount = new Set(
      resolvedOrders.map((o) => o.customer_id)
    ).size;

    const potentialClaimPoolBRL = round2(
      activeEnriched.reduce(
        (acc, o) => acc + o.economics.eligibleCarrierClaimBRL,
        0
      )
    );

    const allBrands = Array.from(
      new Set(enrichedOrders.map((o) => o.marca))
    ).sort();
    const allCarriers = Array.from(
      new Set(enrichedOrders.map((o) => o.transportadora))
    ).sort();

    return {
      customersMap,
      carriersByUf,
      enrichedOrders,
      activeEnriched,
      autoTriagedOrders,
      resolvedOrders,
      allPortfolios,
      simulation,
      anomalies,
      totalActiveExposureBRL,
      totalOrderValueActiveBRL,
      totalProtectedSavingsBRL,
      resolvedTreatmentsCount,
      potentialClaimPoolBRL,
      allBrands,
      allCarriers,
    };
  }, [rawOrders, customers, carriers, containments]);

  // Apply search & combinable filters
  const filteredData = useMemo(() => {
    if (!computed) {
      return { portfolios: [], orders: [] };
    }

    const q = filters.search.trim().toLowerCase();
    const multiOrderCustomerIds = new Set(
      computed.allPortfolios
        .filter((p) => p.orderCount >= 2)
        .map((p) => p.customer_id)
    );

    const matchesOrder = (o: (typeof computed.enrichedOrders)[number]) => {
      if (filters.marca !== "all" && o.marca !== filters.marca) return false;
      if (
        filters.tipoExcecao !== "all" &&
        o.tipo_excecao !== filters.tipoExcecao
      )
        return false;
      if (filters.cd !== "all" && o.cd !== filters.cd) return false;
      if (
        filters.transportadora !== "all" &&
        o.transportadora !== filters.transportadora
      )
        return false;
      if (filters.onlyVip && !o.isVipCustomer) return false;
      if (filters.onlyMultiOrder && !multiOrderCustomerIds.has(o.customer_id))
        return false;
      if (!q) return true;
      return (
        o.order_id.toLowerCase().includes(q) ||
        o.customer_id.toLowerCase().includes(q) ||
        o.sku.toLowerCase().includes(q) ||
        o.descricao_produto.toLowerCase().includes(q) ||
        o.cidade.toLowerCase().includes(q) ||
        o.lote_produto.toLowerCase().includes(q) ||
        (o.maquina ?? "").toLowerCase().includes(q)
      );
    };

    if (filters.scope === "resolved") {
      const orders = computed.resolvedOrders.filter(matchesOrder);
      // Group resolved orders by customer for portfolio display
      const byCust = new Map<string, typeof orders>();
      for (const o of orders) {
        const list = byCust.get(o.customer_id) ?? [];
        list.push(o);
        byCust.set(o.customer_id, list);
      }
      const portfolios: CustomerPortfolio[] = Array.from(byCust.entries()).map(
        ([cid, list]) => ({
          customer_id: cid,
          customer: computed.customersMap.get(cid) ?? {
            customer_id: cid,
            n_pedidos: list[0].customerOrderCount,
            receita_acumulada: list[0].customerAccumulatedRevenue,
            data_primeiro_pedido: list[0].data_pedido,
            n_contatos_atendimento: 1,
          },
          isVip: list[0].isVipCustomer,
          orders: list,
          orderCount: list.length,
          totalOrderValueBRL: round2(list.reduce((a, x) => a + x.valor, 0)),
          directOrderRiskBRL: 0,
          marginalCliffBRL: 0,
          customerLtvRiskBRL: list[0].customerLtvAtRiskSingleBRL,
          avoidedSacContactsBRL: Math.max(0, list.length - 1) * 9,
          freightConsolidationSavingsBRL: 0,
          riskTotalBRL: round2(
            list.reduce((a, x) => a + (x.resolvedSavingsBRL ?? 0), 0)
          ),
          canConsolidatePhysicalBox: false,
          earliestExceptionDate: list[0].data_abertura_excecao,
          brands: Array.from(new Set(list.map((x) => x.marca))),
          exceptionTypes: Array.from(new Set(list.map((x) => x.tipo_excecao))),
          anomalyBadges: [],
          topPriorityReason: `Resolvido (${list[0].resolvedAction ?? "OK"})`,
        })
      );
      return { portfolios, orders };
    }

    // Active scopes: top150 vs all_active
    const remainingSlotsToday = Math.max(
      1,
      DAILY_HUMAN_CAPACITY - computed.resolvedTreatmentsCount
    );
    const basePool =
      filters.scope === "top150" && !q
        ? computed.allPortfolios.slice(0, remainingSlotsToday)
        : computed.allPortfolios;

    const portfolios = basePool
      .map((p) => {
        const matchedOrders = p.orders.filter(matchesOrder);
        if (matchedOrders.length === 0) return null;
        if (filters.onlyMultiOrder && p.orderCount < 2) return null;
        if (filters.onlyVip && !p.isVip) return null;
        return p;
      })
      .filter((p): p is CustomerPortfolio => p !== null);

    const allowedCustomerIds = new Set(portfolios.map((p) => p.customer_id));
    const orders = computed.activeEnriched
      .filter((o) => allowedCustomerIds.has(o.customer_id) && matchesOrder(o))
      .sort(
        (a, b) =>
          b.directOrderRiskBRL +
          b.marginalCliffBRL -
          (a.directOrderRiskBRL + a.marginalCliffBRL)
      );

    return { portfolios, orders };
  }, [computed, filters]);

  async function handleResetSimulation() {
    setIsResetting(true);
    try {
      await ensureDatabaseSeeded(true);
      setCachedPlans({});
      setSelectedCustomerId(null);
      setToast("Base restaurada para os 2.042 pedidos originais!");
    } finally {
      setIsResetting(false);
    }
  }

  function handleExportCsv() {
    if (!computed) return;
    const rowsToExport =
      activeTab === "audit"
        ? computed.autoTriagedOrders
        : filteredData.orders;
    const csv = serializeEnrichedOrdersCsv(rowsToExport);
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `opera-gogroup-export-${activeTab}-${rowsToExport.length}-pedidos.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setToast(
      `CSV exportado com ${rowsToExport.length} pedido(s) enriquecido(s)!`
    );
  }

  async function handleExecutePortfolioResolution(params: {
    portfolio: CustomerPortfolio;
    plan: PortfolioResolutionPlan | null;
    actionOverrides: Record<string, RecommendedActionType>;
    customMessage: string;
  }) {
    const res = await executePortfolioResolution({
      customerId: params.portfolio.customer_id,
      enrichedOrders: params.portfolio.orders,
      plan: params.plan,
      actionOverrides: params.actionOverrides,
      customMessage: params.customMessage,
    });

    setToast(
      `✅ Carteira ${params.portfolio.customer_id} resolvida (${res.resolvedCount} ped.) • +${formatBRL(res.totalSavingsBRL)} protegidos${
        res.claimsOpened > 0
          ? ` • ${res.claimsOpened} sinistro(s) aberto(s)!`
          : "!"
      }`
    );

    // Move selection automatically to next top portfolio
    const nextPortfolio = filteredData.portfolios.find(
      (p) => p.customer_id !== params.portfolio.customer_id
    );
    setSelectedCustomerId(nextPortfolio?.customer_id ?? null);
  }

  if (isBootstrapping || !computed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <Loader2 className="h-9 w-9 animate-spin text-slate-900" />
        <h2 className="mt-3 text-base font-bold text-slate-900">
          Inicializando Central Opera Gogroup...
        </h2>
        <p className="mt-1 max-w-md text-xs text-slate-500">
          Carregando pedidos no seu workspace local isolado (IndexedDB), executando Auto-Triagem Zero-Toque e calculando R$ em Risco por carteira.
        </p>
        {bootError && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
            {bootError}
          </div>
        )}
      </div>
    );
  }

  const activeContainments = (containments ?? []).filter((c) => c.active);
  const claimsList = claims ?? [];
  const claimsTotalBRL = round2(
    claimsList.reduce((acc, c) => acc + c.valor_reclamado_brl, 0)
  );
  const exportCount =
    activeTab === "audit"
      ? computed.autoTriagedOrders.length
      : filteredData.orders.length;

  return (
    <div className="min-h-screen pb-12">
      <KpiHeader
        totalActiveExposureBRL={computed.totalActiveExposureBRL}
        totalOrderValueActiveBRL={computed.totalOrderValueActiveBRL}
        totalProtectedSavingsBRL={computed.totalProtectedSavingsBRL}
        resolvedTreatmentsCount={computed.resolvedTreatmentsCount}
        resolvedOrdersCount={computed.resolvedOrders.length}
        autoTriagedCount={computed.autoTriagedOrders.length}
        claimsTotalBRL={claimsTotalBRL}
        claimsCount={claimsList.length}
        activeContainmentsCount={activeContainments.length}
        filteredExportCount={exportCount}
        simulation={computed.simulation}
        onOpenIngest={() => setIsIngestOpen(true)}
        onExportFilteredCsv={handleExportCsv}
        onResetSimulation={handleResetSimulation}
        isResetting={isResetting}
      />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-slate-900 px-4 py-3 text-xs font-semibold text-white shadow-xl">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* Main Content Container */}
      <main className="mx-auto max-w-[1600px] px-4 pt-4 sm:px-6">
        {/* Primary Navigation Tabs */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <nav className="inline-flex flex-wrap gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
            <button
              type="button"
              onClick={() => setActiveTab("queue")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === "queue"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Layers className="h-4 w-4 text-emerald-400" />
              1. Fila Inteligente Top 150 ({computed.allPortfolios.length} carteiras)
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("radar")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === "radar"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Radar className="h-4 w-4 text-rose-400" />
              2. Radar Sistêmico & Causas-Raiz (6)
              {activeContainments.length > 0 && (
                <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] text-slate-950">
                  {activeContainments.length} ativas
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("audit")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === "audit"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <ShieldCheck className="h-4 w-4 text-amber-400" />
              3. Auto-Triagem ({computed.autoTriagedOrders.length}) & Ressarcimentos ({claimsList.length})
            </button>
          </nav>

          <div className="text-xs text-slate-500">
            Workspace isolado no navegador •{" "}
            <strong>{computed.enrichedOrders.length}</strong> pedidos monitorados
          </div>
        </div>

        {/* Active Tab View */}
        {activeTab === "queue" && (
          <SmartQueueTab
            filters={filters}
            onChangeFilters={setFilters}
            filteredPortfolios={filteredData.portfolios}
            filteredOrders={filteredData.orders}
            allBrands={computed.allBrands}
            allCarriers={computed.allCarriers}
            customersMap={computed.customersMap}
            carriersByUf={computed.carriersByUf}
            activeContainments={activeContainments}
            selectedCustomerId={selectedCustomerId}
            onSelectCustomerId={setSelectedCustomerId}
            cachedPlans={cachedPlans}
            onPlanGenerated={(cid, plan) =>
              setCachedPlans((prev) => ({ ...prev, [cid]: plan }))
            }
            onExecuteResolution={handleExecutePortfolioResolution}
          />
        )}

        {activeTab === "radar" && (
          <SystemicRadarTab
            simulation={computed.simulation}
            anomalies={computed.anomalies}
            containments={containments ?? []}
            allOrders={computed.enrichedOrders}
            onActivateContainment={async (plan: SystemicContainmentPlan) => {
              await activateSystemicContainment(plan);
              setToast(`🛡️ Ordem de Contenção ativada: ${plan.title}`);
            }}
            onToggleContainment={async (id, active) => {
              await toggleContainmentActive(id, active);
              setToast(
                active ? "Regra de contenção reativada." : "Regra de contenção pausada."
              );
            }}
          />
        )}

        {activeTab === "audit" && (
          <AutoTriageAuditTab
            autoTriagedOrders={computed.autoTriagedOrders}
            claims={claimsList}
            auditLogs={auditLogs ?? []}
            potentialClaimPoolBRL={computed.potentialClaimPoolBRL}
            onRevertToHumanQueue={async (orderId) => {
              await revertAutoTriagedOrderToHumanQueue(orderId);
              setToast(`Pedido ${orderId} revertido para a Fila Humana!`);
            }}
          />
        )}
      </main>

      <IngestModal
        isOpen={isIngestOpen}
        onClose={() => setIsIngestOpen(false)}
        onIngestOrders={async (orders: RawOrder[], source) => {
          const result = await ingestNewOrders(orders, source);
          if (orders.length === 1 && result.activeAdded === 1) {
            setSelectedCustomerId(orders[0].customer_id);
            setActiveTab("queue");
          }
          return result;
        }}
      />
    </div>
  );
}
